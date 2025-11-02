import { createSolanaRpc, Commitment } from '@solana/kit';
import config from '../config';
import logger from './logger';

// 类型定义
interface GetBlockConfig {
  commitment?: Commitment;
  maxSupportedTransactionVersion?: number;
  transactionDetails?: 'full' | 'accounts' | 'none' | 'signatures';
  rewards?: boolean;
  encoding?: 'json' | 'jsonParsed' | 'base58' | 'base64';
}

export class SolanaClient {
  private rpc: ReturnType<typeof createSolanaRpc>;
  private backupRpc?: ReturnType<typeof createSolanaRpc>;

  constructor() {
    // 创建主 RPC 客户端
    this.rpc = createSolanaRpc(config.solanaRpcUrl);

    // 创建备份 RPC 客户端（如果配置了）
    if (config.solanaRpcUrlBackup) {
      this.backupRpc = createSolanaRpc(config.solanaRpcUrlBackup);
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
      const slot = await this.rpc.getSlot({ commitment }).send();
      logger.debug('获取最新槽位', { slot, commitment });
      return Number(slot);
    } catch (error) {
      logger.error('获取最新槽位失败', { error, commitment });

      // 尝试使用备份连接
      if (this.backupRpc) {
        try {
          logger.info('尝试使用备份连接获取最新槽位');
          const slot = await this.backupRpc.getSlot({ commitment }).send();
          return Number(slot);
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
  async getBlock(slot: number, config?: GetBlockConfig): Promise<any | null> {
    try {
      const blockConfig: any = {
        commitment: config?.commitment || 'confirmed',
        maxSupportedTransactionVersion: config?.maxSupportedTransactionVersion ?? 0,
        transactionDetails: config?.transactionDetails || 'full',
        rewards: config?.rewards ?? true,
        encoding: config?.encoding || 'jsonParsed'
      };

      const block = await this.rpc.getBlock(BigInt(slot), blockConfig).send();

      if (!block) {
        logger.debug('槽位无区块（可能被跳过）', { slot });
        return null;
      }

      logger.debug('获取区块成功', {
        slot,
        txCount: Array.isArray((block as any).transactions) ? (block as any).transactions.length : 0,
        blockTime: block.blockTime
      });

      return block;
    } catch (error: any) {
      // 如果是槽位被跳过的错误，返回 null 而不是抛出异常
      if (error?.message?.includes('skipped') || error?.message?.includes('not available')) {
        logger.debug('槽位被跳过', { slot });
        return null;
      }

      logger.error('获取区块失败', { slot, error });

      // 尝试使用备份连接
      if (this.backupRpc) {
        try {
          logger.info('尝试使用备份连接获取区块', { slot });
          const blockConfig: any = {
            commitment: config?.commitment || 'confirmed',
            maxSupportedTransactionVersion: config?.maxSupportedTransactionVersion ?? 0,
            transactionDetails: config?.transactionDetails || 'full',
            rewards: config?.rewards ?? true,
            encoding: config?.encoding || 'jsonParsed'
          };
          const block = await this.backupRpc.getBlock(BigInt(slot), blockConfig).send();
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
      let slots: bigint[];
      if (endSlot !== undefined) {
        slots = await this.rpc.getBlocks(BigInt(startSlot), BigInt(endSlot)).send();
      } else {
        slots = await this.rpc.getBlocks(BigInt(startSlot)).send();
      }

      const numberSlots = slots.map(s => Number(s));
      logger.debug('批量获取槽位列表', { startSlot, endSlot, count: numberSlots.length });
      return numberSlots;
    } catch (error) {
      logger.error('批量获取槽位失败', { startSlot, endSlot, error });

      if (this.backupRpc) {
        try {
          logger.info('尝试使用备份连接批量获取槽位');
          let slots: bigint[];
          if (endSlot !== undefined) {
            slots = await this.backupRpc.getBlocks(BigInt(startSlot), BigInt(endSlot)).send();
          } else {
            slots = await this.backupRpc.getBlocks(BigInt(startSlot)).send();
          }
          return slots.map(s => Number(s));
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
   * 获取 RPC 实例（用于其他操作）
   */
  getRpc(): ReturnType<typeof createSolanaRpc> {
    return this.rpc;
  }
}

// 导出单例
export const solanaClient = new SolanaClient();
