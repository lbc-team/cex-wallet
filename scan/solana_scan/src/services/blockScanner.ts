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

      // 验证父区块（检测回滚）
      if (block.parentSlot !== undefined && block.parentSlot !== null) {
        await this.verifyParentBlock(slot, block.parentSlot, block.previousBlockhash);
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
      for (const deposit of deposits) {
        await transactionParser.processDeposit(deposit);
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
   * 验证父区块（检测回滚）
   * 验证当前区块的 previousBlockhash 是否与数据库中父区块的 block_hash 匹配
   */
  private async verifyParentBlock(
    currentSlot: number,
    parentSlot: number,
    previousBlockhash: string | undefined
  ): Promise<void> {
    try {
      // 如果当前区块没有 previousBlockhash，无法验证
      if (!previousBlockhash) {
        logger.debug('当前区块缺少 previousBlockhash，无法验证父区块', { currentSlot, parentSlot });
        return;
      }

      // 从数据库查询父区块信息
      const dbParentSlot = await database.get(
        'SELECT slot, block_hash, status FROM solana_slots WHERE slot = ?',
        [parentSlot]
      );

      // 如果数据库中没有父区块记录，不需要检查（可能还未扫描到）
      if (!dbParentSlot) {
        logger.debug('数据库中未找到父区块记录', { currentSlot, parentSlot });
        return;
      }

      // 如果父区块已经 finalized，不需要检查回滚
      if (dbParentSlot.status === 'finalized') {
        return;
      }

      // 如果父区块在数据库中是 skipped，但当前区块认为它有 previousBlockhash
      // 说明父区块实际存在，需要重新扫描
      if (dbParentSlot.status === 'skipped') {
        logger.warn('父区块状态异常：数据库标记为 skipped 但链上存在', {
          currentSlot,
          parentSlot,
          previousBlockhash
        });
        // 重新扫描父区块（会更新其 block_hash）
        await this.scanSingleSlot(parentSlot);
        return;
      }

      // 如果数据库中没有父区块的 block_hash，无法验证
      if (!dbParentSlot.block_hash) {
        logger.debug('父区块缺少 block_hash，无法验证', { parentSlot });
        return;
      }

      // 验证当前区块的 previousBlockhash 是否等于数据库中父区块的 block_hash
      if (previousBlockhash !== dbParentSlot.block_hash) {
        // block_hash 不匹配，发生了回滚
        logger.warn('检测到回滚：previousBlockhash 不匹配', {
          currentSlot,
          parentSlot,
          previousBlockhash,
          dbParentBlockHash: dbParentSlot.block_hash
        });
        await this.handleSlotReorg(parentSlot);
        return;
      }

      // 验证通过
      logger.debug('父区块验证通过', {
        currentSlot,
        parentSlot,
        previousBlockhash
      });

    } catch (error) {
      logger.error('验证父区块失败', { currentSlot, parentSlot, error });
      // 验证失败不影响当前区块的处理
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
