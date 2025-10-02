import { viemClient } from '../utils/viemClient';
import { walletDAO, tokenDAO } from '../db/models';
import { creditDAO } from '../db/creditDAO';
import { getDbGatewayClient } from './dbGatewayClient';
import logger from '../utils/logger';
import config from '../config';

export interface NetworkFinality {
  safe: boolean;
  finalized: boolean;
}

export interface FinalityCache {
  safe: { block: { number: bigint; hash: string } | null; timestamp: number };
  finalized: { block: { number: bigint; hash: string } | null; timestamp: number };
  ttl: number;
}

/**
 * 确认管理器 - 混合使用网络终结性和确认数
 */
export class ConfirmationManager {
  private networkSupportsFinality: NetworkFinality | null = null;
  private finalityCache: FinalityCache = {
    safe: { block: null, timestamp: 0 },
    finalized: { block: null, timestamp: 0 },
    ttl: 30000 // 30秒缓存
  };
  private dbGatewayClient = getDbGatewayClient();

  /**
   * 初始化：检测网络终结性支持
   */
  async initialize(): Promise<void> {
    try {
      this.networkSupportsFinality = await viemClient.supportsFinality();
      
      logger.info('确认管理器初始化完成', {
        useNetworkFinality: config.useNetworkFinality,
        networkSupport: this.networkSupportsFinality,
        confirmationBlocks: config.confirmationBlocks,
        safeBlocks: Math.floor(config.confirmationBlocks / 2)
      });
    } catch (error) {
      logger.error('确认管理器初始化失败', { error });
      // 初始化失败时禁用网络终结性
      this.networkSupportsFinality = { safe: false, finalized: false };
    }
  }

  /**
   * 处理交易确认（混合策略: POS 网络终结性 和 区块确认数）
   */
  async processConfirmations(): Promise<void> {
    try {
      const pendingTransactions = await this.dbGatewayClient.getPendingTransactionsWithSQL();
      
      if (pendingTransactions.length === 0) {
        return;
      }

      logger.debug('开始处理交易确认', { 
        pendingCount: pendingTransactions.length,
        useNetworkFinality: config.useNetworkFinality && this.networkSupportsFinality
      });

      // 决定使用的确认策略
      if (config.useNetworkFinality && this.networkSupportsFinality) {
        await this.processWithNetworkFinality(pendingTransactions);
      } else {
        await this.processWithConfirmationCount(pendingTransactions);
      }

    } catch (error) {
      logger.error('处理交易确认失败', { error });
    }
  }

  /**
   * 使用网络终结性处理确认
   */
  private async processWithNetworkFinality(transactions: any[]): Promise<void> {
    // 获取缓存的终结性区块
    const safeBlock = await this.getCachedSafeBlock();
    const finalizedBlock = await this.getCachedFinalizedBlock();

    logger.debug('网络终结性状态', {
      safeBlock: safeBlock ? Number(safeBlock.number) : null,
      finalizedBlock: finalizedBlock ? Number(finalizedBlock.number) : null
    });

    for (const tx of transactions) {
      await this.updateTransactionWithFinality(tx, safeBlock, finalizedBlock);
    }
  }

  /**
   * 使用确认数处理确认（回退策略）
   */
  private async processWithConfirmationCount(transactions: any[]): Promise<void> {
    const currentBlock = await viemClient.getLatestBlockNumber();

    const safeThreshold = Math.floor(config.confirmationBlocks / 2);
    const finalizedThreshold = config.confirmationBlocks;
    
    logger.debug('使用确认数策略', {
      currentBlock,
      safeThreshold,
      finalizedThreshold
    });

    for (const tx of transactions) {
      const confirmations = currentBlock - tx.block_no;
      await this.updateTransactionWithConfirmationCount(tx, confirmations);
    }
  }

  /**
   * 基于网络终结性更新交易状态
   */
  private async updateTransactionWithFinality(
    tx: any,
    safeBlock: { number: bigint; hash: string } | null,
    finalizedBlock: { number: bigint; hash: string } | null
  ): Promise<void> {
    try {
      // 优先检查 finalized
      if (this.networkSupportsFinality?.finalized && finalizedBlock) {
        if (tx.block_no <= Number(finalizedBlock.number)) {
          if (tx.status !== 'finalized') {
            await this.finalizeTransaction(tx, 'network_finality');
            return;
          }
        }
      }

      // 检查 safe
      if (this.networkSupportsFinality?.safe && safeBlock) {
        if (tx.block_no <= Number(safeBlock.number)) {
          if (tx.status === 'confirmed') {
            await this.safeTransaction(tx, 'network_finality');
            return;
          }
        }
      }

      // 如果网络终结性不适用，回退到确认数
      const currentBlock = await viemClient.getLatestBlockNumber();
      const confirmations = currentBlock - tx.block_no;
      await this.updateTransactionWithConfirmationCount(tx, confirmations);

    } catch (error) {
      logger.error('基于网络终结性更新交易状态失败', { 
        txHash: tx.tx_hash, 
        error 
      });
    }
  }

  /**
   * 基于确认数更新交易状态
   */
  private async updateTransactionWithConfirmationCount(tx: any, confirmations: number): Promise<void> {
    try {
      const safeThreshold = Math.floor(config.confirmationBlocks / 2);
      const finalizedThreshold = config.confirmationBlocks;
      
      if (tx.status === 'confirmed' && confirmations >= safeThreshold) {
        await this.safeTransaction(tx, 'confirmation_count');
      } else if (tx.status === 'safe' && confirmations >= finalizedThreshold) {
        await this.finalizeTransaction(tx, 'confirmation_count');
      }

      // 更新确认数
      await this.dbGatewayClient.updateTransactionConfirmation(tx.tx_hash, confirmations);

    } catch (error) {
      logger.error('基于确认数更新交易状态失败', { 
        txHash: tx.tx_hash, 
        confirmations, 
        error 
      });
    }
  }

  /**
   * 将交易标记为 safe
   */
  private async safeTransaction(tx: any, method: 'network_finality' | 'confirmation_count'): Promise<void> {
    await this.dbGatewayClient.updateTransactionStatus(tx.tx_hash, 'safe');
    
    logger.info('交易状态更新为 safe', { 
      txHash: tx.tx_hash, 
      blockNo: tx.block_no,
      method,
      fromStatus: tx.status
    });
  }

  /**
   * 将交易标记为 finalized 并入账
   */
  private async finalizeTransaction(tx: any, method: 'network_finality' | 'confirmation_count'): Promise<void> {
    try {
      if (tx.type === 'deposit') {
        const wallet = await walletDAO.getWalletByAddress(tx.to_addr);
        if (wallet) {
          // 动态获取当前链ID
          const chainId = await viemClient.getChainId();
          
          let token: any = null;
          let tokenSymbol = 'ETH';
          
          if (tx.token_addr && tx.token_addr !== '0x0000000000000000000000000000000000000000') {
            // 匹配链ID 的 ERC20代币
            token = await tokenDAO.getTokenByAddress(tx.token_addr, 'eth', chainId);
            tokenSymbol = token ? token.token_symbol : 'UNKNOWN';
          } else {
            // 原生代币（token_addr为null或全零地址），使用 is_native 字段查找
            token = await tokenDAO.getNativeToken(chainId);
            tokenSymbol = token ? token.token_symbol : 'UNKNOWN';
          }

          if (!token) {
            logger.error('未找到代币信息', { 
              tokenAddr: tx.token_addr, 
              tokenSymbol,
              method
            });
            return;
          }

          const amount = tx.amount; // amount已经是以最小单位存储的字符串
          
          // 通过 db_gateway API 更新现有Credit记录的状态为finalized（Credit记录已在processDeposit时创建）
          await this.dbGatewayClient.updateCreditStatusByTxHash(tx.tx_hash, 'finalized');


          await this.dbGatewayClient.updateTransactionStatus(tx.tx_hash, 'finalized');

          logger.info('存款余额已更新', {
            txHash: tx.tx_hash,
            address: tx.to_addr,
            chainType: token.chain_type,
            chainId: token.chain_id,
            tokenSymbol: token.token_symbol,
            amount: amount.toString(),
            method
          });
        }
      }
    } catch (error) {
      logger.error('最终确认交易失败', { 
        txHash: tx.tx_hash, 
        method, 
        error 
      });
    }
  }

  /**
   * 获取缓存的 safe 区块
   */
  private async getCachedSafeBlock(): Promise<{ number: bigint; hash: string } | null> {
    const now = Date.now();
    if (now - this.finalityCache.safe.timestamp < this.finalityCache.ttl) {
      return this.finalityCache.safe.block;
    }
    
    const block = await viemClient.getSafeBlock();
    this.finalityCache.safe = { block, timestamp: now };
    return block;
  }

  /**
   * 获取缓存的 finalized 区块
   */
  private async getCachedFinalizedBlock(): Promise<{ number: bigint; hash: string } | null> {
    const now = Date.now();
    if (now - this.finalityCache.finalized.timestamp < this.finalityCache.ttl) {
      return this.finalityCache.finalized.block;
    }
    
    const block = await viemClient.getFinalizedBlock();
    this.finalityCache.finalized = { block, timestamp: now };
    return block;
  }

  /**
   * 获取确认统计信息
   */
  async getConfirmationStats(): Promise<{
    networkFinality: NetworkFinality | null;
    safeBlock: number | null;
    finalizedBlock: number | null;
    method: 'network_finality' | 'confirmation_count';
  }> {
    const safeBlock = await this.getCachedSafeBlock();
    const finalizedBlock = await this.getCachedFinalizedBlock();

    return {
      networkFinality: this.networkSupportsFinality,
      safeBlock: safeBlock ? Number(safeBlock.number) : null,
      finalizedBlock: finalizedBlock ? Number(finalizedBlock.number) : null,
      method: (config.useNetworkFinality && this.networkSupportsFinality) 
        ? 'network_finality' 
        : 'confirmation_count'
    };
  }
}

export const confirmationManager = new ConfirmationManager();
