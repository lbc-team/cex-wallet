import { database } from './connection';
import logger from '../utils/logger';

export interface SolanaSlot {
  slot: number;
  block_hash?: string;
  parent_slot?: number;
  block_time?: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SolanaTransaction {
  id: number;
  slot: number;
  tx_hash: string;
  from_addr?: string;
  to_addr: string;
  token_mint?: string;
  amount: string;
  type: string;
  status: string;
  block_time?: number;
  created_at: string;
  updated_at?: string;
}

export interface Wallet {
  id: number;
  user_id: number;
  address: string;
  device?: string;
  path?: string;
  chain_type: string;
  wallet_type: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Token {
  id: number;
  chain_type: string;
  chain_id: number;
  token_address?: string;
  token_symbol: string;
  token_name?: string;
  decimals: number;
  is_native: boolean;
  collect_amount: string;
  status: number;
  created_at: string;
  updated_at: string;
}

export interface SolanaTokenAccount {
  id: number;
  user_id?: number;
  wallet_id: number;
  wallet_address: string;
  token_mint: string;
  ata_address: string;
  created_at: string;
  updated_at: string;
}

/**
 * Solana槽位数据访问对象
 */
export class SolanaSlotDAO {
  /**
   * 获取槽位信息
   */
  async getSlot(slot: number): Promise<SolanaSlot | null> {
    try {
      const row = await database.get('SELECT * FROM solana_slots WHERE slot = ?', [slot]);
      return row || null;
    } catch (error) {
      logger.error('获取槽位失败', { slot, error });
      throw error;
    }
  }

  /**
   * 获取最后扫描的槽位
   */
  async getLastScannedSlot(): Promise<number | null> {
    try {
      const row = await database.get(
        'SELECT MAX(slot) as max_slot FROM solana_slots WHERE status != "skipped"'
      );
      return row?.max_slot || null;
    } catch (error) {
      logger.error('获取最后扫描槽位失败', { error });
      throw error;
    }
  }

  /**
   * 获取最近的槽位（排除跳过的槽位）
   */
  async getRecentSlots(limit: number = 100): Promise<SolanaSlot[]> {
    try {
      const rows = await database.all(
        'SELECT * FROM solana_slots WHERE status != "skipped" ORDER BY slot DESC LIMIT ?',
        [limit]
      );
      return rows;
    } catch (error) {
      logger.error('获取最近槽位失败', { limit, error });
      throw error;
    }
  }

  /**
   * 获取最近的 confirmed 状态的槽位（用于重新验证）
   */
  async getRecentConfirmedSlots(limit: number): Promise<SolanaSlot[]> {
    try {
      const rows = await database.all(
        'SELECT * FROM solana_slots WHERE status = "confirmed" ORDER BY slot DESC LIMIT ?',
        [limit]
      );
      return rows;
    } catch (error) {
      logger.error('获取最近confirmed槽位失败', { limit, error });
      throw error;
    }
  }

  /**
   * 检查槽位范围内是否有空槽
   */
  async checkForMissingSlots(startSlot: number, endSlot: number): Promise<number[]> {
    try {
      const existingSlots = await database.all(
        'SELECT slot FROM solana_slots WHERE slot >= ? AND slot <= ? ORDER BY slot',
        [startSlot, endSlot]
      );

      const missing: number[] = [];
      const existingSet = new Set(existingSlots.map((r: any) => r.slot));

      for (let slot = startSlot; slot <= endSlot; slot++) {
        if (!existingSet.has(slot)) {
          missing.push(slot);
        }
      }

      return missing;
    } catch (error) {
      logger.error('检查缺失槽位失败', { startSlot, endSlot, error });
      throw error;
    }
  }
}

/**
 * Solana交易数据访问对象
 */
export class SolanaTransactionDAO {
  /**
   * 获取需要进一步确认的Solana交易
   */
  async getPendingSolanaTransactions(): Promise<SolanaTransaction[]> {
    try {
      const rows = await database.all(
        'SELECT * FROM solana_transactions WHERE status IN (?) ORDER BY slot ASC',
        ['confirmed']
      );
      return rows;
    } catch (error) {
      logger.error('获取待确认Solana交易失败', { error });
      throw error;
    }
  }

  /**
   * 根据槽位号获取交易
   */
  async getTransactionsBySlot(slot: number): Promise<SolanaTransaction[]> {
    try {
      const rows = await database.all(
        'SELECT * FROM solana_transactions WHERE slot = ?',
        [slot]
      );
      return rows;
    } catch (error) {
      logger.error('根据槽位获取交易失败', { slot, error });
      throw error;
    }
  }
}

/**
 * 钱包数据访问对象
 */
export class WalletDAO {
  /**
   * 获取所有Solana钱包地址
   */
  async getAllSolanaWalletAddresses(): Promise<string[]> {
    try {
      const rows = await database.all(
        'SELECT DISTINCT address FROM wallets WHERE chain_type = ? AND is_active = 1',
        ['solana']
      );
      return rows.map((row: any) => row.address);
    } catch (error) {
      logger.error('获取所有Solana钱包地址失败', { error });
      throw error;
    }
  }

  /**
   * 根据地址获取钱包信息
   */
  async getWalletByAddress(address: string): Promise<Wallet | null> {
    try {
      const row = await database.get(
        'SELECT * FROM wallets WHERE address = ? AND chain_type = ?',
        [address, 'solana']
      );
      return row || null;
    } catch (error) {
      logger.error('根据地址获取钱包失败', { address, error });
      throw error;
    }
  }
}

/**
 * 代币数据访问对象
 */
export class TokenDAO {
  /**
   * 获取所有Solana代币
   */
  async getAllSolanaTokens(): Promise<Token[]> {
    try {
      const rows = await database.all(
        'SELECT * FROM tokens WHERE chain_type = ? AND status = 1',
        ['solana']
      );
      return rows;
    } catch (error) {
      logger.error('获取所有Solana代币失败', { error });
      throw error;
    }
  }

  /**
   * 根据Mint地址获取代币信息
   */
  async getTokenByMintAddress(mintAddress: string): Promise<Token | null> {
    try {
      const row = await database.get(
        'SELECT * FROM tokens WHERE chain_type = ? AND token_address = ? AND status = 1',
        ['solana', mintAddress]
      );
      return row || null;
    } catch (error) {
      logger.error('根据Mint地址获取代币失败', { mintAddress, error });
      throw error;
    }
  }

  /**
   * 获取Solana原生代币（SOL）
   */
  async getSolNativeToken(): Promise<Token | null> {
    try {
      const row = await database.get(
        'SELECT * FROM tokens WHERE chain_type = ? AND is_native = 1 AND status = 1',
        ['solana']
      );
      return row || null;
    } catch (error) {
      logger.error('获取SOL原生代币失败', { error });
      throw error;
    }
  }
}

/**
 * Solana代币账户数据访问对象（只读）
 * 注意：所有写操作必须通过 db_gateway 服务
 */
export class SolanaTokenAccountDAO {
  /**
   * 获取ATA到钱包地址的映射
   */
  async getATAToWalletMap(): Promise<Map<string, string>> {
    try {
      const rows = await database.all(
        'SELECT ata_address, wallet_address FROM solana_token_accounts'
      );
      const map = new Map<string, string>();
      for (const row of rows) {
        map.set(row.ata_address.toLowerCase(), row.wallet_address);
      }
      return map;
    } catch (error) {
      logger.error('获取ATA到钱包地址映射失败', { error });
      throw error;
    }
  }

  /**
   * 获取ATA到Token Mint的映射
   */
  async getATAToMintMap(): Promise<Map<string, string>> {
    try {
      const rows = await database.all(
        'SELECT ata_address, token_mint FROM solana_token_accounts'
      );
      const map = new Map<string, string>();
      for (const row of rows) {
        map.set(row.ata_address.toLowerCase(), row.token_mint);
      }
      return map;
    } catch (error) {
      logger.error('获取ATA到Mint映射失败', { error });
      throw error;
    }
  }
}

// 导出DAO实例
export const solanaSlotDAO = new SolanaSlotDAO();
export const solanaTransactionDAO = new SolanaTransactionDAO();
export const walletDAO = new WalletDAO();
export const tokenDAO = new TokenDAO();
export const solanaTokenAccountDAO = new SolanaTokenAccountDAO();

// 导出数据库实例
export { database } from './connection';
