import { Connection, Commitment, BlockResponse, GetVersionedBlockConfig, VersionedBlockResponse } from '@solana/web3.js';
import config from '../config';
import logger from './logger';

export class SolanaClient {
  private connection: Connection;
  private backupConnection?: Connection;

  constructor() {
    // 创建主连接
    this.connection = new Connection(config.solanaRpcUrl, {
      commitment: 'confirmed' as Commitment,
      confirmTransactionInitialTimeout: 60000
    });

    // 创建备份连接（如果配置了）
    if (config.solanaRpcUrlBackup) {
      this.backupConnection = new Connection(config.solanaRpcUrlBackup, {
        commitment: 'confirmed' as Commitment,
        confirmTransactionInitialTimeout: 60000
      });
    }

    logger.info('Solana客户端初始化完成', {
      rpcUrl: config.solanaRpcUrl,
      hasBackup: !!config.solanaRpcUrlBackup
    });
  }

  /**
   * 获取最新槽位
   */
  async getLatestSlot(commitment: Commitment = 'confirmed'): Promise<number> {
    try {
      const slot = await this.connection.getSlot(commitment);
      logger.debug('获取最新槽位', { slot, commitment });
      return slot;
    } catch (error) {
      logger.error('获取最新槽位失败', { error, commitment });

      // 尝试使用备份连接
      if (this.backupConnection) {
        try {
          logger.info('尝试使用备份连接获取最新槽位');
          const slot = await this.backupConnection.getSlot(commitment);
          return slot;
        } catch (backupError) {
          logger.error('备份连接也失败', { backupError });
        }
      }

      throw error;
    }
  }

  /**
   * 等待下一个槽位
   */
  async waitForNextSlot(targetSlot: number, maxRetries: number = 30): Promise<number> {
    let retries = 0;

    while (retries < maxRetries) {
      const currentSlot = await this.getLatestSlot('confirmed');

      if (currentSlot >= targetSlot) {
        logger.debug('已到达目标槽位', { currentSlot, targetSlot });
        return currentSlot;
      }

      // 等待一段时间（Solana平均出块时间约400-600ms）
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
    }

    throw new Error(`等待槽位 ${targetSlot} 超时`);
  }

  /**
   * 获取区块信息
   */
  async getBlock(slot: number, config?: GetVersionedBlockConfig): Promise<VersionedBlockResponse | null> {
    try {
      const block = await this.connection.getBlock(slot, {
        maxSupportedTransactionVersion: 0,
        ...config
      });

      if (!block) {
        logger.debug('槽位无区块（可能被跳过）', { slot });
        return null;
      }

      logger.debug('获取区块成功', {
        slot,
        txCount: block.transactions.length,
        blockTime: block.blockTime
      });

      return block;
    } catch (error) {
      logger.error('获取区块失败', { slot, error });

      // 尝试使用备份连接
      if (this.backupConnection) {
        try {
          logger.info('尝试使用备份连接获取区块', { slot });
          const block = await this.backupConnection.getBlock(slot, {
            maxSupportedTransactionVersion: 0,
            ...config
          });
          return block;
        } catch (backupError) {
          logger.error('备份连接获取区块也失败', { slot, backupError });
        }
      }

      throw error;
    }
  }

  /**
   * 批量获取区块
   */
  async getBlocks(startSlot: number, endSlot?: number): Promise<number[]> {
    try {
      const slots = await this.connection.getBlocks(startSlot, endSlot);
      logger.debug('批量获取槽位列表', { startSlot, endSlot, count: slots.length });
      return slots;
    } catch (error) {
      logger.error('批量获取槽位失败', { startSlot, endSlot, error });

      if (this.backupConnection) {
        try {
          logger.info('尝试使用备份连接批量获取槽位');
          const slots = await this.backupConnection.getBlocks(startSlot, endSlot);
          return slots;
        } catch (backupError) {
          logger.error('备份连接批量获取槽位也失败', { backupError });
        }
      }

      throw error;
    }
  }

  /**
   * 检查槽位是否已确认
   */
  async isSlotConfirmed(slot: number): Promise<boolean> {
    try {
      const confirmedSlot = await this.getLatestSlot('confirmed');
      return slot <= confirmedSlot;
    } catch (error) {
      logger.error('检查槽位确认状态失败', { slot, error });
      return false;
    }
  }

  /**
   * 检查槽位是否已最终确认
   */
  async isSlotFinalized(slot: number): Promise<boolean> {
    try {
      const finalizedSlot = await this.getLatestSlot('finalized');
      return slot <= finalizedSlot;
    } catch (error) {
      logger.error('检查槽位最终确认状态失败', { slot, error });
      return false;
    }
  }

  /**
   * 获取最终确认的槽位
   */
  async getFinalizedSlot(): Promise<number> {
    return this.getLatestSlot('finalized');
  }

  /**
   * 获取Connection实例（用于其他操作）
   */
  getConnection(): Connection {
    return this.connection;
  }
}

// 导出单例
export const solanaClient = new SolanaClient();
