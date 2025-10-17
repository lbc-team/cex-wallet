import { solanaClient } from '../utils/solanaClient';
import { database, solanaSlotDAO } from '../db/models';
import { transactionParser } from './txParser';
import { getDbGatewayClient } from './dbGatewayClient';
import logger from '../utils/logger';
import config from '../config';

export interface ScanProgress {
  currentSlot: number;
  latestSlot: number;
  isUpToDate: boolean;
  scannedSlots: number;
}

export class BlockScanner {
  private isScanning: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private dbGatewayClient = getDbGatewayClient();

  /**
   * 启动扫描服务
   */
  async startScanning(): Promise<void> {
    if (this.isScanning) {
      logger.warn('区块扫描器已在运行');
      return;
    }

    this.isScanning = true;

    logger.info('启动Solana区块扫描器', {
      startSlot: config.startSlot,
      batchSize: config.scanBatchSize,
      confirmationThreshold: config.confirmationThreshold,
      useFinalizedOnly: config.useFinalizedOnly
    });

    try {
      // 执行初始同步扫描
      await this.performInitialSync();

      // 启动定时扫描
      this.startIntervalScanning();
    } catch (error) {
      logger.error('启动扫描器失败', { error });
      this.isScanning = false;
      throw error;
    }
  }

  /**
   * 停止扫描
   */
  stopScanning(): void {
    if (!this.isScanning) {
      return;
    }

    this.isScanning = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    logger.info('Solana区块扫描器已停止');
  }

  /**
   * 执行初始同步扫描
   */
  private async performInitialSync(): Promise<void> {
    logger.info('开始初始同步扫描...');

    // 获取当前最新槽位
    let latestSlot = await solanaClient.getLatestSlot();

    // 获取最后扫描的槽位
    const lastScannedSlot = await this.getLastScannedSlot();
    let currentSlot = lastScannedSlot + 1;

    logger.info('同步扫描状态', {
      startFromSlot: currentSlot,
      latestSlot: latestSlot,
      slotsToSync: latestSlot - currentSlot + 1
    });

    // 连续扫描直到追上最新槽位
    while (currentSlot <= latestSlot && this.isScanning) {
      const endSlot = Math.min(currentSlot + config.scanBatchSize - 1, latestSlot);

      logger.info('扫描槽位批次', {
        startSlot: currentSlot,
        endSlot: endSlot,
        batchSize: endSlot - currentSlot + 1,
        progress: `${endSlot}/${latestSlot} (${((endSlot / latestSlot) * 100).toFixed(2)}%)`
      });

      try {
        await this.scanSlotBatch(currentSlot, endSlot);

        currentSlot = endSlot + 1;

        // 检查是否有新的槽位产生
        const newLatestSlot = await solanaClient.getLatestSlot();
        if (newLatestSlot > latestSlot) {
          logger.info('检测到新槽位', {
            oldLatest: latestSlot,
            newLatest: newLatestSlot
          });
          latestSlot = newLatestSlot;
        }
      } catch (error) {
        logger.error('扫描批次失败', {
          startSlot: currentSlot,
          endSlot: endSlot,
          error
        });
        throw error;
      }
    }

    logger.info('初始同步扫描完成', {
      lastScannedSlot: currentSlot - 1,
      latestSlot: latestSlot
    });
  }

  /**
   * 扫描槽位批次
   */
  private async scanSlotBatch(startSlot: number, endSlot: number): Promise<void> {
    try {
      // 使用 getBlocks 获取有区块的槽位列表
      const slots = await solanaClient.getBlocks(startSlot, endSlot);

      logger.debug('批量获取槽位列表', {
        startSlot,
        endSlot,
        actualSlots: slots.length
      });

      // 扫描每个槽位
      for (const slot of slots) {
        if (!this.isScanning) break;

        await this.scanSingleSlot(slot);
      }

      // 标记跳过的槽位
      await this.markSkippedSlots(startSlot, endSlot, slots);
    } catch (error) {
      logger.error('扫描槽位批次失败', { startSlot, endSlot, error });
      throw error;
    }
  }

  /**
   * 扫描单个槽位
   */
  private async scanSingleSlot(slot: number): Promise<void> {
    try {
      logger.debug('扫描槽位', { slot });

      // 检查槽位是否已处理
      const existingSlot = await solanaSlotDAO.getSlot(slot);
      if (existingSlot && existingSlot.status === 'finalized') {
        logger.debug('槽位已最终确认，跳过', { slot });
        return;
      }

      // 检测可能的回滚
      await this.checkForReorg(slot);

      // 获取区块信息
      const block = await solanaClient.getBlock(slot);

      if (!block) {
        logger.debug('槽位无区块', { slot });
        await this.dbGatewayClient.insertSolanaSlot({
          slot,
          status: 'skipped'
        });
        return;
      }

      // 处理区块
      await this.processBlock(slot, block);
    } catch (error) {
      logger.error('扫描槽位失败', { slot, error });
      throw error;
    }
  }

  /**
   * 处理区块
   */
  private async processBlock(slot: number, block: any): Promise<void> {
    try {
      // 解析区块中的交易
      const deposits = await transactionParser.parseBlock(block, slot);

      // 插入槽位记录
      await this.dbGatewayClient.insertSolanaSlot({
        slot,
        block_hash: block.blockhash || undefined,
        parent_slot: block.parentSlot || undefined,
        block_time: block.blockTime || undefined,
        status: 'confirmed'
      });

      // 处理检测到的存款
      for (const deposit of deposits) {
        await transactionParser.processDeposit(deposit);
      }

      logger.debug('槽位处理完成', {
        slot,
        blockhash: block.blockhash,
        transactions: block.transactions?.length || 0,
        deposits: deposits.length
      });
    } catch (error) {
      logger.error('处理区块失败', { slot, error });
      throw error;
    }
  }

  /**
   * 检查并处理回滚（Solana的回滚较少见但可能发生）
   */
  private async checkForReorg(currentSlot: number): Promise<void> {
    try {
      // 检查最近几个槽位的状态
      const checkDepth = Math.min(config.reorgCheckDepth, currentSlot);
      const startCheckSlot = Math.max(0, currentSlot - checkDepth);

      // 获取这些槽位的链上信息
      const chainSlots = await solanaClient.getBlocks(startCheckSlot, currentSlot - 1);

      // 获取数据库中的槽位
      const dbSlots = await database.all(
        'SELECT slot FROM solana_slots WHERE slot >= ? AND slot < ? AND status != "skipped"',
        [startCheckSlot, currentSlot]
      );

      const dbSlotSet = new Set(dbSlots.map((s: any) => s.slot));
      const chainSlotSet = new Set(chainSlots);

      // 检查是否有数据库中存在但链上不存在的槽位（可能被跳过或回滚）
      for (const dbSlot of dbSlotSet) {
        if (!chainSlotSet.has(dbSlot)) {
          logger.warn('检测到可能的槽位回滚', { slot: dbSlot });
          await this.handleSlotReorg(dbSlot);
        }
      }
    } catch (error) {
      logger.error('检查回滚失败', { currentSlot, error });
    }
  }

  /**
   * 处理槽位回滚
   */
  private async handleSlotReorg(slot: number): Promise<void> {
    try {
      logger.info('处理槽位回滚', { slot });

      // 删除该槽位的 credit 记录
      await this.dbGatewayClient.deleteCreditsBySlotRange(slot, slot);

      // 删除该槽位的Solana交易记录
      await this.dbGatewayClient.deleteSolanaTransactionsBySlot(slot);

      // 更新槽位状态为 skipped
      await this.dbGatewayClient.updateSolanaSlotStatus(slot, 'skipped');

      logger.info('槽位回滚处理完成', { slot });
    } catch (error) {
      logger.error('处理槽位回滚失败', { slot, error });
    }
  }

  /**
   * 标记跳过的槽位
   */
  private async markSkippedSlots(
    startSlot: number,
    endSlot: number,
    actualSlots: number[]
  ): Promise<void> {
    try {
      const actualSlotSet = new Set(actualSlots);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        if (!actualSlotSet.has(slot)) {
          // 检查数据库中是否已有记录
          const existing = await solanaSlotDAO.getSlot(slot);
          if (!existing) {
            await this.dbGatewayClient.insertSolanaSlot({
              slot,
              status: 'skipped'
            });
          }
        }
      }
    } catch (error) {
      logger.error('标记跳过槽位失败', { startSlot, endSlot, error });
    }
  }

  /**
   * 启动定时扫描
   */
  private startIntervalScanning(): void {
    logger.info('启动定时扫描', { interval: config.scanInterval });

    this.intervalTimer = setInterval(async () => {
      if (!this.isScanning) {
        return;
      }

      try {
        await this.scanNewSlots();
      } catch (error) {
        logger.error('定时扫描失败', { error });
      }
    }, config.scanInterval * 1000);
  }

  /**
   * 扫描新槽位（定时任务）
   */
  private async scanNewSlots(): Promise<void> {
    try {
      const latestSlot = await solanaClient.getLatestSlot();
      const lastScannedSlot = await this.getLastScannedSlot();

      if (latestSlot > lastScannedSlot) {
        const startSlot = lastScannedSlot + 1;
        const endSlot = Math.min(startSlot + config.scanBatchSize - 1, latestSlot);

        logger.info('定时扫描新槽位', {
          startSlot,
          endSlot,
          newSlots: endSlot - startSlot + 1
        });

        await this.scanSlotBatch(startSlot, endSlot);
      } else {
        logger.debug('没有新槽位');
      }
    } catch (error) {
      logger.error('扫描新槽位失败', { error });
    }
  }

  /**
   * 获取最后扫描的槽位号
   */
  private async getLastScannedSlot(): Promise<number> {
    try {
      const lastSlot = await solanaSlotDAO.getLastScannedSlot();

      if (lastSlot !== null) {
        return lastSlot;
      }

      // 如果没有扫描过任何槽位，返回配置的起始槽位减一
      return config.startSlot - 1;
    } catch (error) {
      logger.error('获取最后扫描槽位失败', { error });
      return config.startSlot - 1;
    }
  }

  /**
   * 获取扫描进度
   */
  async getScanProgress(): Promise<ScanProgress> {
    try {
      const latestSlot = await solanaClient.getLatestSlot();
      const lastScannedSlot = await this.getLastScannedSlot();

      const isUpToDate = lastScannedSlot >= latestSlot;

      return {
        currentSlot: lastScannedSlot,
        latestSlot,
        isUpToDate,
        scannedSlots: lastScannedSlot
      };
    } catch (error) {
      logger.error('获取扫描进度失败', { error });
      throw error;
    }
  }

  /**
   * 手动触发扫描
   */
  async triggerScan(): Promise<void> {
    if (!this.isScanning) {
      throw new Error('扫描器未运行');
    }

    logger.info('手动触发扫描');
    await this.scanNewSlots();
  }
}

export const blockScanner = new BlockScanner();
