import {
  PublicKey,
  VersionedTransactionResponse,
  ParsedInstruction,
  PartiallyDecodedInstruction,
  ParsedTransactionWithMeta
} from '@solana/web3.js';
import { walletDAO, tokenDAO } from '../db/models';
import { getDbGatewayClient } from './dbGatewayClient';
import logger from '../utils/logger';

// SPL Token Program IDs
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

export interface ParsedDeposit {
  txHash: string;
  slot: number;
  fromAddr?: string;
  toAddr: string;
  tokenMint?: string;
  amount: string;
  type: 'sol' | 'spl-token' | 'spl-token-2022';
  userId?: number;
  tokenId?: number;
  blockTime?: number;
}

export class TransactionParser {
  private dbGatewayClient = getDbGatewayClient();
  private monitoredAddresses: Set<string> = new Set();
  private tokenMintMap: Map<string, any> = new Map();
  private lastAddressUpdate: number = 0;
  private lastTokenUpdate: number = 0;

  constructor() {
    this.refreshCache();
  }

  /**
   * 刷新监控地址和代币缓存
   */
  async refreshCache(): Promise<void> {
    try {
      logger.info('刷新监控地址和代币缓存...');

      // 获取所有Solana钱包地址
      const addresses = await walletDAO.getAllSolanaWalletAddresses();
      this.monitoredAddresses = new Set(addresses.map(addr => addr.toLowerCase()));

      // 获取所有Solana代币
      const tokens = await tokenDAO.getAllSolanaTokens();
      this.tokenMintMap.clear();
      for (const token of tokens) {
        if (token.token_address) {
          this.tokenMintMap.set(token.token_address.toLowerCase(), token);
        }
      }

      this.lastAddressUpdate = Date.now();
      this.lastTokenUpdate = Date.now();

      logger.info('缓存刷新完成', {
        addressCount: this.monitoredAddresses.size,
        tokenCount: this.tokenMintMap.size
      });
    } catch (error) {
      logger.error('刷新缓存失败', { error });
      throw error;
    }
  }

  /**
   * 解析区块中的交易
   */
  async parseBlock(block: any, slot: number): Promise<ParsedDeposit[]> {
    if (!block || !block.transactions) {
      return [];
    }

    const deposits: ParsedDeposit[] = [];

    for (const tx of block.transactions) {
      try {
        const parsedDeposits = await this.parseTransaction(tx, slot, block.blockTime);
        deposits.push(...parsedDeposits);
      } catch (error) {
        logger.error('解析交易失败', { slot, error });
      }
    }

    return deposits;
  }

  /**
   * 解析单个交易
   */
  private async parseTransaction(
    tx: any,
    slot: number,
    blockTime?: number | null
  ): Promise<ParsedDeposit[]> {
    const deposits: ParsedDeposit[] = [];

    if (!tx.meta || tx.meta.err) {
      // 跳过失败的交易
      return deposits;
    }

    // 获取所有交易签名
    const signatures = tx.transaction.signatures || [];

    // 处理每个签名（虽然通常第一个是主签名，但我们记录所有签名）
    for (const txHash of signatures) {
      // 解析 instructions 中的转账（包括 SOL 和 SPL Token）
      const transferDeposits = await this.parseInstructionTransfers(tx, slot, txHash, blockTime);
      deposits.push(...transferDeposits);
    }

    return deposits;
  }

  /**
   * 解析 instructions 中的转账（统一处理 SOL 和 SPL Token）
   */
  private async parseInstructionTransfers(
    tx: any,
    slot: number,
    txHash: string,
    blockTime?: number | null
  ): Promise<ParsedDeposit[]> {
    const deposits: ParsedDeposit[] = [];

    try {
      const instructions = tx.transaction.message.instructions || [];
      const innerInstructions = tx.meta.innerInstructions || [];

      // 解析主指令
      for (const ix of instructions) {
        const deposit = await this.parseInstruction(ix, tx, slot, txHash, blockTime);
        if (deposit) deposits.push(deposit);
      }

      // 解析内部指令
      for (const innerIx of innerInstructions) {
        for (const ix of innerIx.instructions || []) {
          const deposit = await this.parseInstruction(ix, tx, slot, txHash, blockTime);
          if (deposit) deposits.push(deposit);
        }
      }
    } catch (error) {
      logger.error('解析转账失败', { txHash, error });
    }

    return deposits;
  }

  /**
   * 解析单个指令（统一处理 SOL 和 Token 转账）
   */
  private async parseInstruction(
    ix: any,
    tx: any,
    slot: number,
    txHash: string,
    blockTime?: number | null
  ): Promise<ParsedDeposit | null> {
    try {
      const programId = ix.programId?.toString() || ix.program;

      // 检查是否是 System Program (SOL 转账)
      if (programId === SYSTEM_PROGRAM_ID) {
        return this.parseSystemProgramInstruction(ix, slot, txHash, blockTime);
      }

      // 检查是否是 Token 程序 (SPL Token 转账)
      if (programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID) {
        // 解析 parsed 指令
        if (ix.parsed) {
          return this.parseParsedTokenInstruction(ix, programId, slot, txHash, blockTime);
        }

        // 解析未解析的指令（需要手动解码）
        return this.parseRawTokenInstruction(ix, tx, programId, slot, txHash, blockTime);
      }

      return null;
    } catch (error) {
      logger.error('解析指令失败', { txHash, error });
      return null;
    }
  }

  /**
   * 解析 System Program 指令 (SOL 转账)
   * Program: 11111111111111111111111111111111
   * Type: transfer
   */
  private parseSystemProgramInstruction(
    ix: any,
    slot: number,
    txHash: string,
    blockTime?: number | null
  ): ParsedDeposit | null {
    try {
      if (!ix.parsed) {
        return null;
      }

      const parsed = ix.parsed;

      // 检查是否是 transfer 类型
      if (parsed.type !== 'transfer') {
        return null;
      }

      const info = parsed.info;
      const destination = info.destination;
      const lamports = info.lamports;

      if (!destination || !lamports) {
        return null;
      }

      // 检查目标地址是否是我们监控的地址
      const lowerDest = destination.toLowerCase();
      if (!this.monitoredAddresses.has(lowerDest)) {
        return null;
      }

      return {
        txHash,
        slot,
        fromAddr: info.source || undefined,
        toAddr: destination,
        amount: lamports.toString(),
        type: 'sol',
        blockTime: blockTime || undefined
      };
    } catch (error) {
      logger.error('解析System Program指令失败', { txHash, error });
      return null;
    }
  }

  /**
   * 解析已解析的 Token 指令
   * Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA (SPL Token)
   * Program: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb (SPL Token 2022)
   * Type: transfer / transferChecked
   */
  private parseParsedTokenInstruction(
    ix: any,
    programId: string,
    slot: number,
    txHash: string,
    blockTime?: number | null
  ): ParsedDeposit | null {
    try {
      const parsed = ix.parsed;

      // 检查是否是 transfer 或 transferChecked
      if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') {
        return null;
      }

      const info = parsed.info;
      const destination = info.destination;
      const amount = info.amount || info.tokenAmount?.amount;

      if (!destination || !amount) {
        return null;
      }

      // 检查目标地址是否是我们监控的地址
      const lowerDest = destination.toLowerCase();
      if (!this.monitoredAddresses.has(lowerDest)) {
        return null;
      }

      // 获取 mint 地址
      const mint = info.mint;

      const type = programId === TOKEN_2022_PROGRAM_ID ? 'spl-token-2022' : 'spl-token';

      return {
        txHash,
        slot,
        fromAddr: info.source || undefined,
        toAddr: destination,
        tokenMint: mint,
        amount: amount,
        type,
        blockTime: blockTime || undefined
      };
    } catch (error) {
      logger.error('解析已解析Token指令失败', { txHash, error });
      return null;
    }
  }

  /**
   * 解析原始 Token 指令（需要手动解码）
   * 从 preTokenBalances 和 postTokenBalances 推断转账
   */
  private parseRawTokenInstruction(
    ix: any,
    tx: any,
    programId: string,
    slot: number,
    txHash: string,
    blockTime?: number | null
  ): ParsedDeposit | null {
    try {
      // 从 preTokenBalances 和 postTokenBalances 推断转账
      const preTokenBalances = tx.meta.preTokenBalances || [];
      const postTokenBalances = tx.meta.postTokenBalances || [];

      for (const postBalance of postTokenBalances) {
        const preBalance = preTokenBalances.find(
          (pb: any) => pb.accountIndex === postBalance.accountIndex
        );

        const preAmount = BigInt(preBalance?.uiTokenAmount?.amount || '0');
        const postAmount = BigInt(postBalance.uiTokenAmount?.amount || '0');
        const change = postAmount - preAmount;

        if (change > 0n) {
          // 余额增加，可能是接收方
          const accountKeys = tx.transaction.message.accountKeys || [];
          const accountKey = accountKeys[postBalance.accountIndex];
          const address = typeof accountKey === 'string' ? accountKey : accountKey?.pubkey?.toString();

          if (!address) continue;

          const lowerAddr = address.toLowerCase();
          if (this.monitoredAddresses.has(lowerAddr)) {
            const type = programId === TOKEN_2022_PROGRAM_ID ? 'spl-token-2022' : 'spl-token';

            return {
              txHash,
              slot,
              toAddr: address,
              tokenMint: postBalance.mint,
              amount: change.toString(),
              type,
              blockTime: blockTime || undefined
            };
          }
        }
      }

      return null;
    } catch (error) {
      logger.error('解析原始Token指令失败', { txHash, error });
      return null;
    }
  }

  /**
   * 处理存款（写入数据库）
   */
  async processDeposit(deposit: ParsedDeposit): Promise<boolean> {
    try {
      // 获取钱包信息
      const wallet = await walletDAO.getWalletByAddress(deposit.toAddr);
      if (!wallet) {
        logger.warn('未找到钱包信息', { address: deposit.toAddr });
        return false;
      }

      // 获取代币信息
      let token;
      if (deposit.type === 'sol') {
        token = await tokenDAO.getSolNativeToken();
      } else if (deposit.tokenMint) {
        token = await tokenDAO.getTokenByMintAddress(deposit.tokenMint);
      }

      if (!token) {
        logger.warn('未找到代币信息', {
          type: deposit.type,
          mint: deposit.tokenMint
        });
        return false;
      }

      // 插入Solana交易记录
      await this.dbGatewayClient.insertSolanaTransaction({
        slot: deposit.slot,
        tx_hash: deposit.txHash,
        from_addr: deposit.fromAddr,
        to_addr: deposit.toAddr,
        token_mint: deposit.tokenMint || undefined,
        amount: deposit.amount,
        type: 'deposit',
        status: 'confirmed',
        block_time: deposit.blockTime
      });

      // 创建 credit 记录
      await this.dbGatewayClient.createCredit({
        user_id: wallet.user_id,
        address: deposit.toAddr,
        token_id: token.id,
        token_symbol: token.token_symbol,
        amount: deposit.amount,
        credit_type: 'deposit',
        business_type: 'blockchain',
        reference_type: 'blockchain_tx',
        chain_type: 'solana',
        status: 'confirmed',
        block_number: deposit.slot,
        tx_hash: deposit.txHash,
        event_index: 0,
        metadata: {
          token_type: deposit.type,
          block_time: deposit.blockTime
        }
      });

      logger.info('处理存款成功', {
        txHash: deposit.txHash,
        slot: deposit.slot,
        address: deposit.toAddr,
        amount: deposit.amount,
        type: deposit.type
      });

      return true;
    } catch (error: any) {
      if (error?.message?.includes('UNIQUE')) {
        logger.debug('存款记录已存在', { txHash: deposit.txHash });
        return true;
      }
      logger.error('处理存款失败', { deposit, error });
      return false;
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      monitoredAddressCount: this.monitoredAddresses.size,
      supportedTokenCount: this.tokenMintMap.size,
      lastAddressUpdate: this.lastAddressUpdate,
      lastTokenUpdate: this.lastTokenUpdate
    };
  }
}

export const transactionParser = new TransactionParser();
