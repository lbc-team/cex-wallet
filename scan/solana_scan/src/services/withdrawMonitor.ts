import { database } from '../db/models';
import logger from '../utils/logger';
import config from '../config';
import { solanaClient } from '../utils/solanaClient';
import { getDbGatewayClient } from './dbGatewayClient';

/**
 * Solana 提现交易监控服务
 * 负责监控提现交易的状态变化：pending -> confirmed -> finalized
 * - pending: 等待区块链确认
 * - confirmed: 交易已确认（slot confirmed）
 * - finalized: 交易已最终确认（slot finalized），不可回滚
 */
export class SolanaWithdrawMonitor {
  private dbGatewayClient = getDbGatewayClient();
  private isRunning: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private readonly MAX_RETRY_COUNT = 10; // 最大重试次数

  /**
   * 启动提现监控服务
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Solana 提现监控服务已在运行');
      return;
    }

    try {
      logger.info('启动 Solana 提现监控服务...');
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

      logger.info('Solana 提现监控服务启动成功', {
        monitorInterval: config.scanInterval * 1000,
        maxRetryCount: this.MAX_RETRY_COUNT
      });
    } catch (error) {
      logger.error('启动 Solana 提现监控服务失败', { error });
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

    logger.info('停止 Solana 提现监控服务...');

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.isRunning = false;
    logger.info('Solana 提现监控服务已停止');
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
      logger.error('监控 Solana 提现交易失败', { error });
    }
  }

  /**
   * 监控待确认的提现交易（pending -> confirmed/failed）
   */
  private async monitorPendingWithdraws(): Promise<void> {
    try {
      // 查询所有 pending 状态的 Solana 提现记录
      const pendingWithdraws = await database.all(`
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
          t.is_native,
          t.token_type
        FROM withdraws w
        LEFT JOIN tokens t ON w.token_id = t.id
        WHERE w.status = 'pending'
        AND w.tx_hash IS NOT NULL
        AND w.chain_type = 'solana'
        ORDER BY w.created_at ASC
      `);

      if (pendingWithdraws.length === 0) {
        logger.debug('没有待确认的 Solana 提现交易');
        return;
      }

      logger.info(`发现 ${pendingWithdraws.length} 条待确认的 Solana 提现交易`);

      // 并发处理多个交易的状态检查
      const promises = pendingWithdraws.map(withdraw =>
        this.checkTransactionStatus(withdraw).catch(error => {
          logger.error('检查 Solana 交易状态失败', {
            withdrawId: withdraw.id,
            txHash: withdraw.tx_hash,
            error
          });
        })
      );

      await Promise.all(promises);

    } catch (error) {
      logger.error('监控待确认 Solana 提现交易失败', { error });
    }
  }

  /**
   * 监控已确认的提现交易（confirmed -> finalized）
   */
  private async monitorConfirmedWithdraws(): Promise<void> {
    try {
      // 查询所有 confirmed 状态的 Solana 提现记录
      const confirmedWithdraws = await database.all(`
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
          t.is_native,
          t.token_type
        FROM withdraws w
        LEFT JOIN tokens t ON w.token_id = t.id
        WHERE w.status = 'confirmed'
        AND w.tx_hash IS NOT NULL
        AND w.chain_type = 'solana'
        ORDER BY w.updated_at ASC
      `);

      if (confirmedWithdraws.length === 0) {
        logger.debug('没有待最终确认的 Solana 提现交易');
        return;
      }

      logger.info(`发现 ${confirmedWithdraws.length} 条待最终确认的 Solana 提现交易`);

      // 并发处理多个交易的最终确认检查
      const promises = confirmedWithdraws.map(withdraw =>
        this.checkFinalizationStatus(withdraw).catch(error => {
          logger.error('检查 Solana 最终确认状态失败', {
            withdrawId: withdraw.id,
            txHash: withdraw.tx_hash,
            error
          });
        })
      );

      await Promise.all(promises);

    } catch (error) {
      logger.error('监控待最终确认 Solana 提现交易失败', { error });
    }
  }

  /**
   * 检查单个交易的状态
   */
  private async checkTransactionStatus(withdraw: any): Promise<void> {
    const {
      id, tx_hash, chain_id, user_id, token_id, amount, fee,
      token_symbol, token_address, token_type, decimals, is_native,
      from_address, to_address
    } = withdraw;

    try {
      // 获取交易详情（使用 confirmed commitment）
      const transaction = await solanaClient.getTransaction(tx_hash, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });

      if (!transaction) {
        logger.debug('Solana 交易未找到（可能还在内存池）', {
          txHash: tx_hash,
          withdrawId: id
        });
        return;
      }

      const slot = Number(transaction.slot);
      const blockTime = transaction.blockTime ? Number(transaction.blockTime) : null;
      const isSuccess = !transaction.meta?.err;

      logger.info('获取到 Solana 交易信息', {
        withdrawId: id,
        txHash: tx_hash,
        slot: slot,
        isSuccess: isSuccess,
        blockTime: blockTime
      });

      if (isSuccess) {
        // 交易成功，更新为确认状态
        await this.updateWithdrawToConfirmed(id, {
          slot,
          blockTime,
          txHash: tx_hash
        });

        // 更新 credits 表状态
        await this.updateCreditStatus(id, 'confirmed', slot);

        // 创建 solana_transactions 表记录
        await this.createSolanaTransactionRecord({
          txHash: tx_hash,
          slot,
          fromAddr: from_address,
          toAddr: to_address,
          tokenMint: is_native ? undefined : token_address,
          amount: amount,
          type: 'withdraw',
          status: 'confirmed',
          blockTime: blockTime
        });

        logger.info('Solana 提现交易确认成功', {
          withdrawId: id,
          txHash: tx_hash,
          userId: user_id,
          amount: amount,
          tokenSymbol: token_symbol,
          slot: slot
        });

      } else {
        // 交易失败
        const errorMessage = transaction.meta?.err
          ? JSON.stringify(transaction.meta.err)
          : '链上交易执行失败';

        await this.updateWithdrawToFailed(id, {
          slot,
          blockTime,
          errorMessage
        });

        // 更新对应的 credit 记录状态为失败（这样在计算余额时会被排除）
        await this.updateCreditStatus(id, 'failed', slot);

        logger.warn('Solana 提现交易执行失败，已恢复用户余额', {
          withdrawId: id,
          txHash: tx_hash,
          userId: user_id,
          amount: amount,
          error: errorMessage
        });
      }

    } catch (error: any) {
      // 检查是否是交易未找到错误（可能还在内存池中或 blockhash 过期）
      if (error.message?.includes('Transaction not found') ||
          error.message?.includes('not found') ||
          error.message?.includes('could not find')) {
        logger.debug('Solana 交易还在内存池中或已过期，继续等待', {
          withdrawId: id,
          txHash: tx_hash
        });
        return;
      }

      logger.error('检查 Solana 交易状态时发生错误', {
        withdrawId: id,
        txHash: tx_hash,
        error: error.message
      });

      // 如果是网络错误等临时问题，不做处理，等待下次重试
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
      // 获取交易详情（使用 confirmed commitment）
      const transaction = await solanaClient.getTransaction(tx_hash, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });

      if (!transaction) {
        logger.warn('无法获取 Solana 交易详情', {
          txHash: tx_hash,
          withdrawId: id
        });
        return;
      }

      const transactionSlot = Number(transaction.slot);

      // 获取 finalized slot
      const finalizedSlot = Number(await solanaClient.getSlot({ commitment: 'finalized' }));

      // 判断交易是否已经 finalized
      const isFinalized = transactionSlot <= finalizedSlot;

      logger.debug('检查 Solana 最终确认状态', {
        withdrawId: id,
        txHash: tx_hash,
        transactionSlot,
        finalizedSlot,
        isFinalized
      });

      if (isFinalized) {
        // 更新提现状态为最终确认
        await this.updateWithdrawToFinalized(id, {
          finalizedAt: new Date().toISOString()
        });

        // 更新 credits 表状态为最终确认
        await this.updateCreditStatus(id, 'finalized', transactionSlot);

        // 更新 solana_transactions 表状态
        await this.updateSolanaTransactionStatus(tx_hash, 'finalized');

        logger.info('Solana 提现交易已最终确认', {
          withdrawId: id,
          txHash: tx_hash,
          userId: user_id,
          amount: amount,
          tokenSymbol: token_symbol,
          transactionSlot,
          finalizedSlot
        });
      } else {
        logger.debug('Solana 交易尚未达到最终确认条件', {
          withdrawId: id,
          txHash: tx_hash,
          transactionSlot,
          finalizedSlot,
          slotsRemaining: finalizedSlot - transactionSlot
        });
      }

    } catch (error: any) {
      logger.error('检查 Solana 最终确认状态时发生错误', {
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
    slot: number;
    blockTime?: number | null;
    txHash: string;
  }): Promise<void> {
    // withdraws 表不存在 block_number 列，slot信息保存在 credits 表中
    await this.dbGatewayClient.updateWithdrawStatus(withdrawId, 'confirmed', {});
  }

  /**
   * 更新提现记录为失败状态
   */
  private async updateWithdrawToFailed(withdrawId: number, updateData: {
    slot?: number;
    blockTime?: number | null;
    errorMessage: string;
  }): Promise<void> {
    // withdraws 表不存在 block_number 列，slot信息保存在 credits 表中
    await this.dbGatewayClient.updateWithdrawStatus(withdrawId, 'failed', {
      error_message: updateData.errorMessage
    });
  }

  /**
   * 更新提现记录为最终确认状态
   */
  private async updateWithdrawToFinalized(withdrawId: number, updateData: {
    finalizedAt: string;
  }): Promise<void> {
    await this.dbGatewayClient.updateWithdrawStatus(withdrawId, 'finalized', {});
  }

  /**
   * 更新 credits 表状态
   */
  private async updateCreditStatus(
    withdrawId: number,
    status: 'confirmed' | 'failed' | 'finalized',
    slot?: number,
  ): Promise<void> {
    await this.dbGatewayClient.updateCreditStatusByReferenceId(
      withdrawId.toString(),
      'withdraw',
      status,
      { block_number: slot }
    );
  }

  /**
   * 创建 solana_transactions 表记录
   */
  private async createSolanaTransactionRecord(data: {
    txHash: string;
    slot: number;
    fromAddr?: string;
    toAddr: string;
    tokenMint?: string;
    amount: string;
    type: string;
    status: string;
    blockTime?: number | null;
  }): Promise<void> {
    try {
      await this.dbGatewayClient.insertSolanaTransaction({
        slot: data.slot,
        tx_hash: data.txHash,
        from_addr: data.fromAddr,
        to_addr: data.toAddr,
        token_mint: data.tokenMint,
        amount: data.amount,
        type: data.type,
        status: data.status,
        block_time: data.blockTime || undefined
      });
    } catch (error: any) {
      // 如果是重复记录错误，忽略
      if (error?.message?.includes('UNIQUE')) {
        logger.debug('Solana 交易记录已存在', { txHash: data.txHash });
        return;
      }
      throw error;
    }
  }

  /**
   * 更新 solana_transactions 表状态
   */
  private async updateSolanaTransactionStatus(txHash: string, status: string): Promise<void> {
    try {
      await this.dbGatewayClient.updateSolanaTransactionStatus(txHash, status);
    } catch (error) {
      logger.error('更新 Solana 交易状态失败', { txHash, status, error });
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

export default SolanaWithdrawMonitor;
