import { viemClient } from '../utils/viemClient';
import { blockDAO, transactionDAO, walletDAO, tokenDAO, balanceDAO, database } from '../db/models';
import { transactionAnalyzer } from './transactionAnalyzer';
import { reorgHandler } from './reorgHandler';
import { confirmationManager } from './confirmationManager';
import logger from '../utils/logger';
import config from '../config';

export interface ScanProgress {
  currentBlock: number;
  latestBlock: number;
  isUpToDate: boolean;
  scannedBlocks: number;
  pendingTransactions: number;
  reorgStats?: {
    totalReorgs: number;
    orphanedBlocks: number;
    revertedTransactions: number;
  };
}

export class BlockScanner {
  private isScanning: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;

  /**
   * 启动扫描服务
   */
  async startScanning(): Promise<void> {
    if (this.isScanning) {
      logger.warn('区块扫描器已在运行');
      return;
    }

    this.isScanning = true;
    
    // 初始化确认管理器
    await confirmationManager.initialize();
    
    logger.info('启动区块扫描器', {
      startBlock: config.startBlock,
      batchSize: config.scanBatchSize,
      confirmationBlocks: config.confirmationBlocks,
      useNetworkFinality: config.useNetworkFinality
    });

    try {
      // 执行初始同步扫描
      await this.performInitialSync();
      
      // 启动定时扫描（仅在追上最新区块后）
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
    logger.info('区块扫描器已停止');
  }

  /**
   * 执行初始同步扫描
   */
  private async performInitialSync(): Promise<void> {
    logger.info('开始初始同步扫描...');

    // 获取当前最新区块
    let latestBlockNumber = await viemClient.getLatestBlockNumber();
    
    // 获取最后扫描的区块
    const lastScannedBlock = await this.getLastScannedBlock();
    let currentBlock = lastScannedBlock + 1;
    
    logger.info('同步扫描状态', {
      startFromBlock: currentBlock,
      latestBlock: latestBlockNumber,
      blocksToSync: latestBlockNumber - currentBlock + 1
    });

    // 连续扫描直到追上最新区块
    while (currentBlock <= latestBlockNumber && this.isScanning) {
      const endBlock = Math.min(currentBlock + config.scanBatchSize - 1, latestBlockNumber);
      
      logger.info('扫描批次', {
        startBlock: currentBlock,
        endBlock: endBlock,
        batchSize: endBlock - currentBlock + 1,
        progress: `${endBlock}/${latestBlockNumber} (${((endBlock / latestBlockNumber) * 100).toFixed(2)}%)`
      });

      try {
        await this.scanBlockBatch(currentBlock, endBlock);
        
        // 扫描进度通过 blocks 表自动更新
        currentBlock = endBlock + 1;

        // 检查是否有新的区块产生
        const newLatestBlock = await viemClient.getLatestBlockNumber();
        if (newLatestBlock > latestBlockNumber) {
          logger.info('检测到新区块', {
            oldLatest: latestBlockNumber,
            newLatest: newLatestBlock
          });
          latestBlockNumber = newLatestBlock;
        }

      } catch (error) {
        logger.error('扫描批次失败', {
          startBlock: currentBlock,
          endBlock: endBlock,
          error
        });
        throw error;
      }
    }

    logger.info('初始同步扫描完成', {
      lastScannedBlock: currentBlock - 1,
      latestBlock: latestBlockNumber
    });
  }

  /**
   * 扫描区块批次
   */
  private async scanBlockBatch(startBlock: number, endBlock: number): Promise<void> {
    for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
      if (!this.isScanning) {
        break;
      }

      try {
        await this.scanSingleBlock(blockNumber);
      } catch (error) {
        logger.error('扫描单个区块失败', { blockNumber, error });
        throw error;
      }
    }
  }

  /**
   * 扫描单个区块
   */
  private async scanSingleBlock(blockNumber: number): Promise<void> {
    try {
      logger.debug('扫描区块', { blockNumber });

      // 获取区块信息
      const block = await viemClient.getBlock(blockNumber);
      if (!block) {
        throw new Error(`区块 ${blockNumber} 不存在`);
      }

      // 检查和处理区块链重组
      const reorgInfo = await reorgHandler.checkAndHandleReorg(blockNumber, block.hash!);
      
      if (reorgInfo) {
        // 如果发生了重组，需要重新扫描从共同祖先开始的区块
        logger.warn('检测到重组，将重新扫描区块', {
          commonAncestor: reorgInfo.commonAncestor,
          blocksToRescan: reorgInfo.blocksToRescan
        });
        
        // 重新扫描需要的区块范围
        const rescanStart = reorgInfo.commonAncestor + 1;
        const rescanEnd = blockNumber;
        
        for (let rescanBlock = rescanStart; rescanBlock <= rescanEnd; rescanBlock++) {
          const chainBlock = await viemClient.getBlock(rescanBlock);
          if (chainBlock) {
            await this.processValidBlock(rescanBlock, chainBlock);
          }
        }
        return; // 重组处理完成，退出当前区块处理
      }

      // 处理有效区块
      await this.processValidBlock(blockNumber, block);

    } catch (error) {
      logger.error('扫描区块失败', { blockNumber, error });
      throw error;
    }
  }

  /**
   * 处理有效区块
   */
  private async processValidBlock(blockNumber: number, block: any): Promise<void> {
    try {
      // 保存区块信息
      await blockDAO.insertBlock({
        hash: block.hash!,
        parent_hash: block.parentHash,
        number: block.number!.toString(),
        timestamp: Number(block.timestamp),
        status: 'confirmed'
      });

      // 分析区块中的交易
      const deposits = await transactionAnalyzer.analyzeBlock(blockNumber);

      // 处理检测到的存款
      for (const deposit of deposits) {
        await transactionAnalyzer.processDeposit(deposit);
      }

      // 处理交易确认
      await confirmationManager.processConfirmations();

      logger.debug('区块扫描完成', {
        blockNumber,
        hash: block.hash,
        transactions: block.transactions.length,
        deposits: deposits.length
      });

    } catch (error) {
      logger.error('处理有效区块失败', { blockNumber, error });
      throw error;
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
        await this.scanNewBlocks();
      } catch (error) {
        logger.error('定时扫描失败', { error });
      }
    }, config.scanInterval * 1000);
  }

  /**
   * 扫描新区块（定时任务）
   */
  private async scanNewBlocks(): Promise<void> {
    try {
      const latestBlockNumber = await viemClient.getLatestBlockNumber();
      const lastScannedBlock = await this.getLastScannedBlock();
      
      if (latestBlockNumber > lastScannedBlock) {
        const startBlock = lastScannedBlock + 1;
        const endBlock = Math.min(startBlock + config.scanBatchSize - 1, latestBlockNumber);

        logger.info('定时扫描新区块', {
          startBlock,
          endBlock,
          newBlocks: endBlock - startBlock + 1
        });

        await this.scanBlockBatch(startBlock, endBlock);
      } else {
        logger.debug('没有新区块');
      }

    } catch (error) {
      logger.error('扫描新区块失败', { error });
    }
  }

  /**
   * 获取最后扫描的区块号
   */
  private async getLastScannedBlock(): Promise<number> {
    try {
      const lastBlock = await database.get(
        'SELECT MAX(CAST(number AS INTEGER)) as max_number FROM blocks WHERE status = "confirmed"'
      );
      
      if (lastBlock && lastBlock.max_number !== null) {
        return lastBlock.max_number;
      }
      
      // 如果没有扫描过任何区块，返回配置的起始区块减一
      return config.startBlock - 1;
      
    } catch (error) {
      logger.error('获取最后扫描区块失败', { error });
      return config.startBlock - 1;
    }
  }

  /**
   * 获取扫描进度
   */
  async getScanProgress(): Promise<ScanProgress> {
    try {
      const latestBlock = await viemClient.getLatestBlockNumber();
      const lastScannedBlock = await this.getLastScannedBlock();
      const pendingTxs = await transactionDAO.getPendingTransactions();
      const reorgStats = await reorgHandler.getReorgStats();

      const isUpToDate = lastScannedBlock >= latestBlock;

      return {
        currentBlock: lastScannedBlock,
        latestBlock,
        isUpToDate,
        scannedBlocks: lastScannedBlock,
        pendingTransactions: pendingTxs.length,
        reorgStats
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
    await this.scanNewBlocks();
  }
}

export const blockScanner = new BlockScanner();