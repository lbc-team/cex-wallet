import { Database } from '../db/connection';
import logger from '../utils/logger';
import config from '../config';
import { viemClient } from '../utils/viemClient';
import { type Hash, type TransactionReceipt } from 'viem';

/**
 * 提现交易监控服务
 * 负责监控提现交易的状态变化：pending -> confirmed -> finalized
 * - pending: 等待区块链确认
 * - confirmed: 交易已确认，但未达到最终确认块数
 * - finalized: 交易已获得足够确认，不可回滚
 */
export class WithdrawMonitor {
  private database: Database;
  private isRunning: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private readonly MAX_RETRY_COUNT = 10; // 最大重试次数
  
  constructor(database: Database) {
    this.database = database;
  }

  /**
   * 启动提现监控服务
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('提现监控服务已在运行');
      return;
    }

    try {
      logger.info('启动提现监控服务...');
      this.isRunning = true;
      
      // 立即执行一次监控
      await this.monitorWithdraws();
      
      // 设置定时器，定期监控
      this.monitorInterval = setInterval(async () => {
        try {
          await this.monitorWithdraws();
        } catch (error) {
          logger.error('定期提现监控失败', { error });
        }
      }, config.scanInterval * 1000); // 将秒转换为毫秒
      
      logger.info('提现监控服务启动成功', {
        monitorInterval: config.scanInterval * 1000,
        maxRetryCount: this.MAX_RETRY_COUNT
      });
    } catch (error) {
      logger.error('启动提现监控服务失败', { error });
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * 停止提现监控服务
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('停止提现监控服务...');
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    this.isRunning = false;
    logger.info('提现监控服务已停止');
  }

  /**
   * 监控提现交易状态（pending -> confirmed -> finalized）
   */
  private async monitorWithdraws(): Promise<void> {
    try {
      // 同时处理 pending 和 confirmed 状态的提现
      await Promise.all([
        this.monitorPendingWithdraws(),
        this.monitorConfirmedWithdraws()
      ]);
    } catch (error) {
      logger.error('监控提现交易失败', { error });
    }
  }

  /**
   * 监控待确认的提现交易（pending -> confirmed/failed）
   */
  private async monitorPendingWithdraws(): Promise<void> {
    try {
      // 查询所有 pending 状态的提现记录
      const pendingWithdraws = await this.database.all(`
        SELECT 
          w.id,
          w.user_id,
          w.token_id,
          w.amount,
          w.fee,
          w.tx_hash,
          w.chain_id,
          w.chain_type,
          w.from_address,
          w.to_address,
          w.created_at,
          t.token_symbol,
          t.token_address,
          t.decimals,
          t.is_native
        FROM withdraws w
        LEFT JOIN tokens t ON w.token_id = t.id
        WHERE w.status = 'pending' 
        AND w.tx_hash IS NOT NULL
        ORDER BY w.created_at ASC
      `);

      if (pendingWithdraws.length === 0) {
        logger.debug('没有待确认的提现交易');
        return;
      }

      logger.info(`发现 ${pendingWithdraws.length} 条待确认的提现交易`);

      // 并发处理多个交易的状态检查
      const promises = pendingWithdraws.map(withdraw => 
        this.checkTransactionStatus(withdraw).catch(error => {
          logger.error('检查交易状态失败', {
            withdrawId: withdraw.id,
            txHash: withdraw.tx_hash,
            error
          });
        })
      );

      await Promise.all(promises);
      
    } catch (error) {
      logger.error('监控待确认提现交易失败', { error });
    }
  }

  /**
   * 监控已确认的提现交易（confirmed -> finalized）
   */
  private async monitorConfirmedWithdraws(): Promise<void> {
    try {
      // 查询所有 confirmed 状态的提现记录
      const confirmedWithdraws = await this.database.all(`
        SELECT 
          w.id,
          w.user_id,
          w.token_id,
          w.amount,
          w.fee,
          w.tx_hash,
          w.chain_id,
          w.chain_type,
          w.from_address,
          w.to_address,
          w.created_at,
          w.updated_at,
          t.token_symbol,
          t.token_address,
          t.decimals,
          t.is_native
        FROM withdraws w
        LEFT JOIN tokens t ON w.token_id = t.id
        WHERE w.status = 'confirmed' 
        AND w.tx_hash IS NOT NULL
        ORDER BY w.updated_at ASC
      `);

      if (confirmedWithdraws.length === 0) {
        logger.debug('没有待最终确认的提现交易');
        return;
      }

      logger.info(`发现 ${confirmedWithdraws.length} 条待最终确认的提现交易`);

      // 并发处理多个交易的最终确认检查
      const promises = confirmedWithdraws.map(withdraw => 
        this.checkFinalizationStatus(withdraw).catch(error => {
          logger.error('检查最终确认状态失败', {
            withdrawId: withdraw.id,
            txHash: withdraw.tx_hash,
            error
          });
        })
      );

      await Promise.all(promises);
      
    } catch (error) {
      logger.error('监控待最终确认提现交易失败', { error });
    }
  }

  /**
   * 检查单个交易的状态
   */
  private async checkTransactionStatus(withdraw: any): Promise<void> {
    const { 
      id, tx_hash, chain_id, user_id, token_id, amount, fee, 
      token_symbol, token_address, decimals, is_native,
      from_address, to_address 
    } = withdraw;
    
    try {
      // 检查链ID是否匹配
      const currentChainId = await viemClient.getChainId();
      if (currentChainId !== chain_id) {
        logger.error('链ID不匹配', { 
          expected: chain_id, 
          actual: currentChainId, 
          withdrawId: id 
        });
        return;
      }

      // 获取交易收据
      const receipt = await viemClient.getTransactionReceipt(tx_hash);

      if (!receipt) {
        logger.debug('交易收据未找到', { txHash: tx_hash, withdrawId: id });
        return;
      }

      // 检查交易状态
      const isSuccess = receipt.status === 'success';
      const gasUsed = receipt.gasUsed.toString();
      const blockNumber = Number(receipt.blockNumber);

      logger.info('获取到交易收据', {
        withdrawId: id,
        txHash: tx_hash,
        status: receipt.status,
        blockNumber: blockNumber,
        gasUsed: gasUsed
      });

      if (isSuccess) {
        // 交易成功，更新为确认状态
        await this.updateWithdrawToConfirmed(id, {
          gasUsed,
          blockNumber,
          txHash: tx_hash
        });

        // 更新 credits 表状态
        await this.updateCreditStatus(id, 'confirmed', blockNumber);

        // 创建 transactions 表记录（用于 scan 服务的统一管理）
        await this.createTransactionRecord({
          txHash: tx_hash,
          blockHash: receipt.blockHash,
          blockNumber,
          fromAddr: from_address,
          toAddr: to_address,
          tokenAddr: is_native ? null : token_address, // 原生代币token_addr为null
          amount: amount,
          type: 'withdraw',
          status: 'confirmed'
        });

        logger.info('提现交易确认成功', {
          withdrawId: id,
          txHash: tx_hash,
          userId: user_id,
          amount: amount,
          tokenSymbol: token_symbol
        });

      } else {
        // 交易失败
        await this.updateWithdrawToFailed(id, {
          gasUsed,
          blockNumber,
          errorMessage: '链上交易执行失败'
        });

        // 更新对应的 credit 记录状态为失败（这样在计算余额时会被排除）
        await this.updateCreditStatus(id, 'failed', blockNumber);

        logger.warn('提现交易执行失败，已恢复用户余额', {
          withdrawId: id,
          txHash: tx_hash,
          userId: user_id,
          amount: amount
        });
      }

    } catch (error: any) {
      // 检查是否是交易未找到错误（可能还在内存池中）
      if (error.message?.includes('Transaction not found') || 
          error.message?.includes('not found')) {
        logger.debug('交易还在内存池中，继续等待', {
          withdrawId: id,
          txHash: tx_hash
        });
        return;
      }

      logger.error('检查交易状态时发生错误', {
        withdrawId: id,
        txHash: tx_hash,
        error: error.message
      });

      // 如果是网络错误等临时问题，不做处理，等待下次重试
      // 如果需要，可以增加重试计数器逻辑
    }
  }

  /**
   * 检查已确认交易是否可以最终确认（confirmed -> finalized）
   */
  private async checkFinalizationStatus(withdraw: any): Promise<void> {
    const { 
      id, tx_hash, chain_id, user_id, token_id, amount, 
      token_symbol, from_address, to_address 
    } = withdraw;
    
    try {
      // 检查链ID是否匹配
      const currentChainId = await viemClient.getChainId();
      if (currentChainId !== chain_id) {
        logger.error('链ID不匹配', { 
          expected: chain_id, 
          actual: currentChainId, 
          withdrawId: id 
        });
        return;
      }

      // 获取交易收据
      const receipt = await viemClient.getTransactionReceipt(tx_hash);

      if (!receipt) {
        logger.warn('无法获取交易收据', { txHash: tx_hash, withdrawId: id });
        return;
      }

      const transactionBlock = Number(receipt.blockNumber);
      let isFinalized = false;
      let finalizationMethod = '';

      // 优先使用网络终结性检查（如果支持）
      if (config.useNetworkFinality) {
        try {
          const finalizedBlock = await viemClient.getFinalizedBlock();
          if (finalizedBlock) {
            isFinalized = transactionBlock <= Number(finalizedBlock.number);
            finalizationMethod = 'network_finality';
            
            logger.debug('使用网络终结性检查', {
              withdrawId: id,
              txHash: tx_hash,
              transactionBlock,
              finalizedBlock: Number(finalizedBlock.number),
              isFinalized
            });
          }
        } catch (error) {
          logger.debug('网络终结性检查失败，回退到确认块数检查', { error });
        }
      }

      // 如果网络终结性不可用，回退到确认块数检查
      if (!isFinalized) {
        const latestBlockNumber = await viemClient.getLatestBlockNumber();
        const confirmationBlocks = latestBlockNumber - transactionBlock;
        isFinalized = confirmationBlocks >= config.confirmationBlocks;
        finalizationMethod = 'confirmation_blocks';
        
        logger.debug('使用确认块数检查', {
          withdrawId: id,
          txHash: tx_hash,
          transactionBlock,
          latestBlock: latestBlockNumber,
          confirmationBlocks,
          requiredBlocks: config.confirmationBlocks,
          isFinalized
        });
      }

      if (isFinalized) {
        // 更新提现状态为最终确认
        await this.updateWithdrawToFinalized(id, {
          finalizationMethod,
          finalizedAt: new Date().toISOString()
        });

        // 更新 credits 表状态为最终确认
        await this.updateCreditStatus(id, 'finalized', transactionBlock);

        logger.info('提现交易已最终确认', {
          withdrawId: id,
          txHash: tx_hash,
          userId: user_id,
          amount: amount,
          tokenSymbol: token_symbol,
          finalizationMethod
        });
      } else {
        logger.debug('交易尚未达到最终确认条件', {
          withdrawId: id,
          txHash: tx_hash,
          finalizationMethod
        });
      }

    } catch (error: any) {
      logger.error('检查最终确认状态时发生错误', {
        withdrawId: id,
        txHash: tx_hash,
        error: error.message
      });
    }
  }

  /**
   * 更新提现记录为确认状态
   */
  private async updateWithdrawToConfirmed(withdrawId: number, updateData: {
    gasUsed: string;
    blockNumber: number;
    txHash: string;
  }): Promise<void> {
    await this.database.run(`
      UPDATE withdraws 
      SET 
        status = 'confirmed',
        gas_used = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [updateData.gasUsed, withdrawId]);
  }

  /**
   * 更新提现记录为失败状态
   */
  private async updateWithdrawToFailed(withdrawId: number, updateData: {
    gasUsed?: string;
    blockNumber?: number;
    errorMessage: string;
  }): Promise<void> {
    await this.database.run(`
      UPDATE withdraws 
      SET 
        status = 'failed',
        gas_used = ?,
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [updateData.gasUsed || null, updateData.errorMessage, withdrawId]);
  }

  /**
   * 更新提现记录为最终确认状态
   */
  private async updateWithdrawToFinalized(withdrawId: number, updateData: {
    finalizationMethod: string;
    finalizedAt: string;
  }): Promise<void> {
    await this.database.run(`
      UPDATE withdraws 
      SET 
        status = 'finalized',
        finalized_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [updateData.finalizedAt, withdrawId]);
  }

  /**
   * 更新 credits 表状态
   */
  private async updateCreditStatus(
    withdrawId: number, 
    status: 'confirmed' | 'failed' | 'finalized',
    blockNumber?: number,
  ): Promise<void> {
    await this.database.run(`
      UPDATE credits 
      SET 
        status = ?,
        block_number = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE reference_id = ? AND reference_type = 'withdraw'
    `, [status, blockNumber || null, withdrawId.toString()]);
  }

  /**
   * 创建 transactions 表记录
   */
  private async createTransactionRecord(data: {
    txHash: string;
    blockHash?: string;
    blockNumber: number;
    fromAddr?: string;
    toAddr?: string;
    tokenAddr?: string;
    amount: string;
    type: string;
    status: string;
  }): Promise<void> {
    try {
      await this.database.run(`
        INSERT OR IGNORE INTO transactions 
        (tx_hash, block_hash, block_no, from_addr, to_addr, token_addr, amount, type, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        data.txHash,
        data.blockHash || null,
        data.blockNumber,
        data.fromAddr || null,
        data.toAddr || null,
        data.tokenAddr || null,
        data.amount,
        data.type,
        data.status
      ]);
    } catch (error: any) {
      // 忽略重复插入错误
      if (!error.message?.includes('UNIQUE constraint failed')) {
        throw error;
      }
    }
  }



  /**
   * 获取监控状态
   */
  getStatus(): {
    isRunning: boolean;
    monitorInterval: number;
    maxRetryCount: number;
  } {
    return {
      isRunning: this.isRunning,
      monitorInterval: config.scanInterval * 1000,
      maxRetryCount: this.MAX_RETRY_COUNT
    };
  }

}

export default WithdrawMonitor;
