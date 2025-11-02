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
  private isScanningInterval: boolean = false; // 防止定时扫描重叠
  private intervalTimer: NodeJS.Timeout | null = null;
  private dbGatewayClient = getDbGatewayClient();
  private cachedFinalizedSlot: number = 0;
  private lastFinalizedSlotUpdate: number = 0;

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
      confirmationThreshold: config.confirmationThreshold,
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
   * 执行初始同步扫描（逐个槽位扫描）
   */
  private async performInitialSync(): Promise<void> {
    logger.info('开始初始同步扫描（逐个槽位模式）...');

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

    // 逐个槽位扫描直到追上最新槽位
    while (currentSlot <= latestSlot && this.isScanning) {
      // 每扫描一定数量的槽位打印进度
      if (currentSlot % 10 === 0 || currentSlot === lastScannedSlot + 1) {
        logger.info('扫描进度', {
          currentSlot,
          latestSlot,
          progress: `${currentSlot}/${latestSlot} (${((currentSlot / latestSlot) * 100).toFixed(2)}%)`
        });
      }

      try {
        // 扫描单个槽位
        await this.scanSingleSlot(currentSlot);

        // 移动到下一个槽位
        currentSlot++;

        // 每扫描 100 个槽位检查是否有新的槽位产生
        if (currentSlot % 100 === 0) {
          const newLatestSlot = await solanaClient.getLatestSlot();
          if (newLatestSlot > latestSlot) {
            logger.info('检测到新槽位', {
              oldLatest: latestSlot,
              newLatest: newLatestSlot,
              newSlots: newLatestSlot - latestSlot
            });
            latestSlot = newLatestSlot;
          }
        }
      } catch (error) {
        logger.error('扫描槽位失败', {
          slot: currentSlot,
          error
        });
        // 继续扫描下一个槽位，不要因为单个槽位失败而停止整个扫描
        currentSlot++;
      }
    }

    logger.info('初始同步扫描完成', {
      lastScannedSlot: currentSlot - 1,
      latestSlot: latestSlot
    });
  }

  /**
   * 获取缓存的 finalized slot（每1秒更新一次）
   * 当检测到新的 finalized slot 时，批量更新历史记录的状态
   */
  private async getCachedFinalizedSlot(): Promise<number> {
    const now = Date.now();
    // 每1秒更新一次 finalized slot
    if (now - this.lastFinalizedSlotUpdate > 1000) {
      try {
        const oldFinalizedSlot = this.cachedFinalizedSlot;
        const newFinalizedSlot = await solanaClient.getFinalizedSlot();

        // 检测到新的 finalized slot
        if (newFinalizedSlot > oldFinalizedSlot && oldFinalizedSlot > 0) {
          logger.info('检测到新的 finalized slot，批量更新历史记录', {
            oldFinalizedSlot,
            newFinalizedSlot,
            slotsToUpdate: newFinalizedSlot - oldFinalizedSlot
          });

          // 批量更新 solana_slots
          const slotsUpdated = await this.dbGatewayClient.updateSolanaSlotStatusToFinalized(newFinalizedSlot);

          // 批量更新 solana_transactions
          const txsUpdated = await this.dbGatewayClient.updateSolanaTransactionStatusToFinalized(newFinalizedSlot);

          // 批量更新 credits
          const creditsUpdated = await this.dbGatewayClient.updateCreditStatusToFinalized(newFinalizedSlot);

          if (slotsUpdated > 0 || txsUpdated > 0 || creditsUpdated > 0) {
            logger.info('批量更新 finalized 状态完成', {
              newFinalizedSlot,
              slotsUpdated,
              txsUpdated,
              creditsUpdated
            });
          }
        }

        this.cachedFinalizedSlot = newFinalizedSlot;
        this.lastFinalizedSlotUpdate = now;
        logger.debug('更新 finalized slot 缓存', { finalizedSlot: this.cachedFinalizedSlot });
      } catch (error) {
        logger.error('获取 finalized slot 失败', { error });
      }
    }
    return this.cachedFinalizedSlot;
  }

  /**
   * 扫描单个槽位
   */
  private async scanSingleSlot(slot: number): Promise<void> {
    try {
      logger.debug('扫描槽位', { slot });

      // 检查槽位是否已处理（从本地数据库读取）
      const existingSlot = await solanaSlotDAO.getSlot(slot);
      if (existingSlot && existingSlot.status === 'finalized') {
        logger.debug('槽位已最终确认，跳过', { slot });
        return;
      }

      // 如果槽位已经被处理为 confirmed 或 skipped，也跳过
      if (existingSlot && (existingSlot.status === 'confirmed' || existingSlot.status === 'skipped')) {
        logger.debug('槽位已处理，跳过', { slot, status: existingSlot.status });
        return;
      }

      // 获取区块信息（使用 confirmed commitment）
      const block = await solanaClient.getBlock(slot);

      if (!block) {
        logger.debug('槽位无区块', { slot });
        await this.dbGatewayClient.insertSolanaSlot({
          slot,
          status: 'skipped'
        });
        return;
      }

      // 检查该 slot 是否已经 finalized（使用缓存）
      const finalizedSlot = await this.getCachedFinalizedSlot();
      const blockStatus = slot <= finalizedSlot ? 'finalized' : 'confirmed';

      // 处理区块（传入状态）
      await this.processBlock(slot, block, blockStatus);
    } catch (error) {
      logger.error('扫描槽位失败', { slot, error });
      throw error;
    }
  }

  /**
   * 处理区块
   */
  private async processBlock(slot: number, block: any, status: string = 'confirmed'): Promise<void> {
    try {
      // 解析区块中的交易（传入状态）
      const deposits = await transactionParser.parseBlock(block, slot, status as 'confirmed' | 'finalized');

      // 插入槽位记录（使用真实的状态）
      await this.dbGatewayClient.insertSolanaSlot({
        slot,
        block_hash: block.blockhash || undefined,
        parent_slot: block.parentSlot || undefined,
        block_time: block.blockTime || undefined,
        status
      });

      // 处理检测到的存款
      let successCount = 0;
      let failureCount = 0;

      for (const deposit of deposits) {
        const success = await transactionParser.processDeposit(deposit);
        if (success) {
          successCount++;
        } else {
          failureCount++;
          logger.error('存款处理失败', {
            slot,
            txHash: deposit.txHash,
            toAddr: deposit.toAddr,
            type: deposit.type
          });
        }
      }

      if (deposits.length > 0) {
        logger.info('槽位存款处理汇总', {
          slot,
          totalDeposits: deposits.length,
          successCount,
          failureCount
        });
      }

      logger.debug('槽位处理完成', {
        slot,
        blockhash: block.blockhash,
        status,
        transactions: block.transactions?.length || 0,
        deposits: deposits.length
      });
    } catch (error) {
      logger.error('处理区块失败', { slot, error });
      throw error;
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
   * 重新验证最近的 confirmed 槽位
   *
   * 检测两种回滚情况：
   * 1. 槽位从有区块变成 skipped（区块消失）
   * 2. 区块哈希改变（区块内容变化）
   *
   * 检测回滚策略：
   * - 先检查最新的 confirmed 槽位
   * - 如果最新的没有变化，直接返回 
   * - 如果有变化，继续向上检查直到找到稳定的槽位
   * - 最多检查 CONFIRMATION_THRESHOLD 个槽位
   */
  private async revalidateRecentConfirmedSlots(): Promise<void> {
    try {
      // 获取最近的 confirmed 槽位（降序排列，最新的在前面）
      const confirmedSlots = await solanaSlotDAO.getRecentConfirmedSlots(config.confirmationThreshold);

      if (confirmedSlots.length === 0) {
        logger.debug('没有需要重新验证的confirmed槽位');
        return;
      }

      logger.debug('开始重新验证confirmed槽位', {
        totalConfirmed: confirmedSlots.length,
        latestSlot: confirmedSlots[0].slot
      });

      let reorgCount = 0;
      let checkedCount = 0;

      // 从最新的槽位开始检查
      for (const dbSlot of confirmedSlots) {
        try {
          checkedCount++;

          // 从链上重新查询槽位信息
          const chainBlock = await solanaClient.getBlock(dbSlot.slot);

          // 情况1：槽位从有区块变成 skipped
          if (!chainBlock) {
            logger.warn('检测到回滚：槽位区块消失', {
              slot: dbSlot.slot,
              dbBlockHash: dbSlot.block_hash
            });
            await this.handleSlotReorg(dbSlot.slot);
            reorgCount++;
            continue; // 继续检查更早的槽位
          }

          // 情况2：区块哈希改变（区块内容变化）
          if (dbSlot.block_hash && chainBlock.blockhash !== dbSlot.block_hash) {
            logger.warn('检测到回滚：区块哈希改变', {
              slot: dbSlot.slot,
              dbBlockHash: dbSlot.block_hash,
              chainBlockHash: chainBlock.blockhash
            });
            await this.handleSlotReorg(dbSlot.slot);
            reorgCount++;
            continue; // 继续检查更早的槽位
          }

          // 验证通过：最新的槽位没有变化
          logger.debug('槽位验证通过', { slot: dbSlot.slot });

          // 优化：如果最新的槽位没有变化，说明之前的槽位也不会有变化
          // 可以安全地提前退出，无需继续检查
          if (checkedCount === 1 && reorgCount === 0) {
            logger.debug('最新槽位验证通过，跳过其余槽位检查', {
              latestSlot: dbSlot.slot,
              skippedCount: confirmedSlots.length - 1
            });
            return; // 早期退出
          }

          // 如果之前有回滚，继续检查直到找到稳定的槽位
          // 找到第一个稳定的槽位后，可以停止检查
          if (reorgCount > 0) {
            logger.info('找到稳定槽位，停止继续检查', {
              stableSlot: dbSlot.slot,
              reorgCount,
              checkedCount,
              remainingSlots: confirmedSlots.length - checkedCount
            });
            break; // 找到稳定点，停止检查
          }

        } catch (error) {
          logger.error('重新验证槽位失败', { slot: dbSlot.slot, error });
          // 单个槽位验证失败不影响其他槽位
        }
      }

      if (reorgCount > 0) {
        logger.warn('重新验证完成：检测到回滚', {
          checkedCount,
          reorgCount,
          totalConfirmed: confirmedSlots.length
        });
      } else {
        logger.debug('重新验证完成：未检测到回滚', {
          checkedCount
        });
      }

    } catch (error) {
      logger.error('重新验证confirmed槽位失败', { error });
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

      // 如果已有扫描在进行中，跳过本次
      if (this.isScanningInterval) {
        logger.debug('上一次定时扫描尚未完成，跳过本次扫描');
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
   * 扫描新槽位（定时任务，逐个槽位扫描）
   */
  private async scanNewSlots(): Promise<void> {
    // 设置扫描标志
    this.isScanningInterval = true;

    try {
      const latestSlot = await solanaClient.getLatestSlot();
      const lastScannedSlot = await this.getLastScannedSlot();

      if (latestSlot > lastScannedSlot) {
        const newSlotsCount = latestSlot - lastScannedSlot;

        logger.info('定时扫描新槽位', {
          lastScannedSlot,
          latestSlot,
          newSlots: newSlotsCount
        });

        // 逐个扫描新槽位
        let currentSlot = lastScannedSlot + 1;
        while (currentSlot <= latestSlot && this.isScanning) {
          try {
            await this.scanSingleSlot(currentSlot);
            currentSlot++;
          } catch (error) {
            logger.error('扫描新槽位失败', { slot: currentSlot, error });
            // 继续扫描下一个槽位
            currentSlot++;
          }
        }

        logger.info('定时扫描完成', {
          scannedSlots: newSlotsCount,
          lastSlot: currentSlot - 1
        });
      } else {
        logger.debug('没有新槽位');
      }

      // 重新验证最近的 confirmed 槽位（检测回滚）
      await this.revalidateRecentConfirmedSlots();

    } catch (error) {
      logger.error('扫描新槽位失败', { error });
    } finally {
      // 清除扫描标志
      this.isScanningInterval = false;
    }
  }

  /**
   * 获取最后扫描的槽位号（从本地数据库读取）
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

}

export const blockScanner = new BlockScanner();
