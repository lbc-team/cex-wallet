import { database } from './connection';
import logger from '../utils/logger';


export interface Block {
  hash: string;
  parent_hash: string;
  number: string;
  timestamp: number;
  created_at: string;
  updated_at: string;
  status?: string;
}

export interface Transaction {
  id: number;
  block_hash: string;
  block_no: number;
  tx_hash: string;
  from_addr: string;
  to_addr: string;
  token_addr?: string;
  amount: string;
  type: string;
  status: string;
  confirmation_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface Wallet {
  id: number;
  user_id: number;
  address: string;
  device: string;
  path: string;
  chain_type: string;
  created_at: string;
  updated_at: string;
}

export interface Token {
  id: number;
  chain_type: string;
  chain_id: number;
  token_address: string;
  token_symbol: string;
  token_name: string;
  decimals: number;
  is_native: boolean;
  collect_amount: string;
  status: number;
  created_at: string;
  updated_at: string;
}

export interface Balance {
  id: number;
  user_id: number;
  address: string;
  token_symbol: string;
  address_type: number;
  balance: string;
  locked_balance: string;
  created_at: string;
  updated_at: string;
}


/**
 * 区块数据访问对象
 */
export class BlockDAO {
  /**
   * 插入区块
   */
  async insertBlock(block: Omit<Block, 'created_at' | 'updated_at'>): Promise<void> {
    try {
      await database.run(
        `INSERT OR REPLACE INTO blocks 
         (hash, parent_hash, number, timestamp, status, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [block.hash, block.parent_hash, block.number, block.timestamp, block.status || 'confirmed']
      );
      logger.debug('插入区块', { hash: block.hash, number: block.number });
    } catch (error) {
      logger.error('插入区块失败', { block, error });
      throw error;
    }
  }

  /**
   * 获取区块
   */
  async getBlock(hash: string): Promise<Block | null> {
    try {
      const row = await database.get('SELECT * FROM blocks WHERE hash = ?', [hash]);
      return row;
    } catch (error) {
      logger.error('获取区块失败', { hash, error });
      throw error;
    }
  }

  /**
   * 根据区块号获取区块（排除孤块）
   */
  async getBlockByNumber(number: number): Promise<Block | null> {
    try {
      const row = await database.get(
        'SELECT * FROM blocks WHERE number = ? AND status != "orphaned" ORDER BY created_at DESC LIMIT 1', 
        [number.toString()]
      );
      return row;
    } catch (error) {
      logger.error('根据区块号获取区块失败', { number, error });
      throw error;
    }
  }

  /**
   * 获取最近的区块（排除孤块）
   */
  async getRecentBlocks(limit: number = 100): Promise<Block[]> {
    try {
      const rows = await database.all(
        'SELECT * FROM blocks WHERE status != "orphaned" ORDER BY CAST(number AS INTEGER) DESC LIMIT ?',
        [limit]
      );
      return rows;
    } catch (error) {
      logger.error('获取最近区块失败', { limit, error });
      throw error;
    }
  }

  /**
   * 标记区块为孤块
   */
  async markBlockAsOrphaned(hash: string): Promise<void> {
    try {
      await database.run(
        'UPDATE blocks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE hash = ?',
        ['orphaned', hash]
      );
      logger.info('标记区块为孤块', { hash });
    } catch (error) {
      logger.error('标记区块为孤块失败', { hash, error });
      throw error;
    }
  }
}

/**
 * 交易数据访问对象
 */
export class TransactionDAO {
  /**
   * 插入交易
   */
  async insertTransaction(tx: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    try {
      const result = await database.run(
        `INSERT INTO transactions 
         (block_hash, block_no, tx_hash, from_addr, to_addr, token_addr, amount, type, status, confirmation_count, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [tx.block_hash, tx.block_no, tx.tx_hash, tx.from_addr, tx.to_addr, tx.token_addr, tx.amount, tx.type, tx.status, tx.confirmation_count || 0]
      );
      logger.debug('插入交易', { txHash: tx.tx_hash, id: result.lastID });
      return result.lastID!;
    } catch (error) {
      logger.error('插入交易失败', { tx, error });
      throw error;
    }
  }

  /**
   * 更新交易确认数（使用网络终结性时可能不需要）
   */
  async updateTransactionConfirmation(txHash: string, confirmationCount: number): Promise<void> {
    try {
      await database.run(
        'UPDATE transactions SET confirmation_count = ?, updated_at = CURRENT_TIMESTAMP WHERE tx_hash = ?',
        [confirmationCount, txHash]
      );
      logger.debug('更新交易确认数', { txHash, confirmationCount });
    } catch (error) {
      logger.error('更新交易确认数失败', { txHash, confirmationCount, error });
      throw error;
    }
  }

  /**
   * 更新交易状态
   */
  async updateTransactionStatus(txHash: string, status: string): Promise<void> {
    try {
      await database.run(
        'UPDATE transactions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE tx_hash = ?',
        [status, txHash]
      );
      logger.debug('更新交易状态', { txHash, status });
    } catch (error) {
      logger.error('更新交易状态失败', { txHash, status, error });
      throw error;
    }
  }

  /**
   * 获取需要进一步确认的交易
   */
  async getPendingTransactions(): Promise<Transaction[]> {
    try {
      const rows = await database.all(
        'SELECT * FROM transactions WHERE status IN (?, ?) ORDER BY block_no ASC',
        ['confirmed', 'safe'] // 获取 confirmed 和 safe 状态的交易
      );
      return rows;
    } catch (error) {
      logger.error('获取未确认交易失败', { error });
      throw error;
    }
  }

  /**
   * 根据区块哈希删除交易（重组时使用）
   */
  async deleteTransactionsByBlockHash(blockHash: string): Promise<void> {
    try {
      await database.run('DELETE FROM transactions WHERE block_hash = ?', [blockHash]);
      logger.info('删除区块相关交易', { blockHash });
    } catch (error) {
      logger.error('删除区块相关交易失败', { blockHash, error });
      throw error;
    }
  }
}

/**
 * 钱包数据访问对象
 */
export class WalletDAO {
  /**
   * 获取所有用户钱包地址
   */
  async getAllWalletAddresses(): Promise<string[]> {
    try {
      const rows = await database.all('SELECT DISTINCT address FROM wallets WHERE chain_type = ?', ['evm']);
      return rows.map(row => row.address.toLowerCase());
    } catch (error) {
      logger.error('获取所有钱包地址失败', { error });
      throw error;
    }
  }

  /**
   * 根据地址获取钱包信息
   */
  async getWalletByAddress(address: string): Promise<Wallet | null> {
    try {
      const row = await database.get('SELECT * FROM wallets WHERE LOWER(address) = LOWER(?)', [address]);
      return row;
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
   * 获取所有支持的代币
   */
  async getAllTokens(): Promise<Token[]> {
    try {
      const rows = await database.all('SELECT * FROM tokens');
      return rows;
    } catch (error) {
      logger.error('获取所有代币失败', { error });
      throw error;
    }
  }

  /**
   * 根据合约地址和链ID获取代币信息
   */
  async getTokenByAddress(tokenAddress: string, chainType?: string, chainId?: number): Promise<Token | null> {
    try {
      let query = 'SELECT * FROM tokens WHERE LOWER(token_address) = LOWER(?)';
      let params: any[] = [tokenAddress];
      
      if (chainType && chainId) {
        query += ' AND chain_type = ? AND chain_id = ?';
        params.push(chainType, chainId);
      }
      
      const row = await database.get(query, params);
      return row;
    } catch (error) {
      logger.error('根据地址获取代币失败', { tokenAddress, chainType, chainId, error });
      throw error;
    }
  }

  /**
   * 根据链信息和代币符号获取代币
   */
  async getTokenBySymbol(chainType: string, chainId: number, tokenSymbol: string): Promise<Token | null> {
    try {
      const row = await database.get(
        'SELECT * FROM tokens WHERE chain_type = ? AND chain_id = ? AND token_symbol = ?',
        [chainType, chainId, tokenSymbol]
      );
      return row;
    } catch (error) {
      logger.error('根据符号获取代币失败', { chainType, chainId, tokenSymbol, error });
      throw error;
    }
  }

  /**
   * 获取指定链的所有代币
   */
  async getTokensByChain(chainId: number): Promise<Token[]> {
    try {
      const rows = await database.all(
        'SELECT * FROM tokens WHERE chain_id = ? AND status = 1',
        [chainId]
      );
      return rows;
    } catch (error) {
      logger.error('获取链代币失败', { chainId, error });
      throw error;
    }
  }

  /**
   * 获取指定链的原生代币
   */
  async getNativeToken(chainId: number): Promise<Token | null> {
    try {
      const row = await database.get(
        'SELECT * FROM tokens WHERE chain_id = ? AND is_native = 1 AND status = 1',
        [chainId]
      );
      return row;
    } catch (error) {
      logger.error('获取原生代币失败', { chainId, error });
      throw error;
    }
  }
}

/**
 * 余额数据访问对象
 */
export class BalanceDAO {
  /**
   * 获取用户余额（支持多链）
   */
  async getBalance(userId: number, address: string, tokenId: number): Promise<Balance | null> {
    try {
      const balance = await database.get(
        'SELECT * FROM balances WHERE user_id = ? AND address = ? AND token_id = ?',
        [userId, address, tokenId]
      );
      return balance;
    } catch (error) {
      logger.error('获取余额失败', { userId, address, tokenId, error });
      throw error;
    }
  }

  /**
   * 根据代币符号获取用户余额（跨链汇总）
   */
  async getBalanceBySymbol(userId: number, tokenSymbol: string): Promise<Balance[]> {
    try {
      const balances = await database.all(
        'SELECT b.* FROM balances b JOIN tokens t ON b.token_id = t.id WHERE b.user_id = ? AND t.token_symbol = ?',
        [userId, tokenSymbol]
      );
      return balances;
    } catch (error) {
      logger.error('根据符号获取余额失败', { userId, tokenSymbol, error });
      throw error;
    }
  }

  /**
   * 获取用户在指定链上的余额
   */
  async getBalanceByChain(userId: number, chainType: string, chainId: number): Promise<Balance[]> {
    try {
      const balances = await database.all(
        'SELECT b.* FROM balances b JOIN tokens t ON b.token_id = t.id WHERE b.user_id = ? AND t.chain_type = ? AND t.chain_id = ?',
        [userId, chainType, chainId]
      );
      return balances;
    } catch (error) {
      logger.error('获取链余额失败', { userId, chainType, chainId, error });
      throw error;
    }
  }

  /**
   * 更新余额（支持多链）
   */
  async updateBalance(userId: number, address: string, chainType: string, tokenId: number, tokenSymbol: string, amount: string): Promise<void> {
    try {
      // 先查找是否存在记录
      const existing = await database.get(
        'SELECT * FROM balances WHERE user_id = ? AND address = ? AND chain_type = ? AND token_id = ?',
        [userId, address, chainType, tokenId]
      );

      if (existing) {
        // 更新现有记录
        const currentBalance = BigInt(existing.balance || '0');
        const newBalance = currentBalance + BigInt(amount);
        
        await database.run(
          'UPDATE balances SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND address = ? AND chain_type = ? AND token_id = ?',
          [newBalance.toString(), userId, address, chainType, tokenId]
        );
      } else {
        // 创建新记录
        await database.run(
          `INSERT INTO balances (user_id, address, chain_type, token_id, token_symbol, address_type, balance, locked_balance, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, address, chainType, tokenId, tokenSymbol, 0, amount, '0']
        );
      }
      
      logger.debug('更新余额', { userId, address, chainType, tokenId, tokenSymbol, amount });
    } catch (error) {
      logger.error('更新余额失败', { userId, address, chainType, tokenId, tokenSymbol, amount, error });
      throw error;
    }
  }

}

// 导出DAO实例
export const blockDAO = new BlockDAO();
export const transactionDAO = new TransactionDAO();
export const walletDAO = new WalletDAO();
export const tokenDAO = new TokenDAO();
export const balanceDAO = new BalanceDAO();

// 导出数据库实例
export { database } from './connection';
