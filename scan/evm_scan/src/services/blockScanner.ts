import { viemClient } from '../utils/viemClient';
import { database } from '../db/models';
import { transactionAnalyzer } from './txAnalyzer';
import { reorgHandler } from './reorgHandler';
import { confirmationManager } from './confirmationManager';
import { getDbGatewayClient } from './dbGatewayClient';
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
        await this.scanBlockBatchStrategy(currentBlock, endBlock);
        
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
   * 扫描区块批次 - 智能选择最优处理策略
   */
  private async scanBlockBatchStrategy(startBlock: number, endBlock: number): Promise<void> {
    const batchSize = endBlock - startBlock + 1;
    
    // 检查 endBlock 是否已经 finalized
    const finalizedBlock = await viemClient.getFinalizedBlock();
    const isEndBlockFinalized = finalizedBlock && endBlock <= Number(finalizedBlock.number);
    
    logger.debug('区块批次处理策略分析', {
      startBlock,
      endBlock,
      batchSize,
      finalizedBlockNumber: finalizedBlock ? Number(finalizedBlock.number) : null,
      isEndBlockFinalized
    });

    // 策略选择：
    // 1. 如果 endBlock 已经 finalized，优先使用历史分析模式（最高效）
    // 2. 否则使用批量模式（兼容所有批次大小）
    
    if (isEndBlockFinalized && batchSize > 3) {
      // 使用历史分析模式处理 finalized 区块
      await this.scanBlockBatchHistorical(startBlock, endBlock);
    } else {
      // 使用批量模式（兼容大小批次）
      await this.scanBlockBatch(startBlock, endBlock);
    }
  }


  /**
   * 批量扫描区块（兼容所有批次大小，支持 bloom 过滤器优化）
   */
  private async scanBlockBatch(startBlock: number, endBlock: number): Promise<void> {
    try {
      logger.debug('使用批量模式扫描区块', { startBlock, endBlock });

      // 批量获取并验证区块信息，同时检查重组
      const blocks: any[] = [];
      let reorgDetected = false;
      let reorgInfo = null;

      for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
        
        const block = await viemClient.getBlock(blockNumber);
        if (!block) {
          throw new Error(`区块 ${blockNumber} 不存在`);
        }

        // 检查重组（只需检查第一个区块，如果有重组会处理整个范围）
        if (blockNumber === startBlock) {
          reorgInfo = await reorgHandler.checkAndHandleReorg(blockNumber, block.hash!);
          if (reorgInfo) {
            reorgDetected = true;
            logger.warn('批量扫描中检测到重组，切换到重组处理模式', {
              blockNumber,
              commonAncestor: reorgInfo.commonAncestor,
              blocksToRescan: reorgInfo.blocksToRescan
            });
            break; // 退出循环，使用重组处理逻辑
          }
        }

        blocks.push({ number: blockNumber, data: block });
      }

      // 如果检测到重组，使用单独的重组处理逻辑
      if (reorgDetected && reorgInfo) {
        const rescanStart = reorgInfo.commonAncestor + 1;
        const rescanEnd = endBlock;
        
        logger.info('重组处理：重新扫描区块范围', { rescanStart, rescanEnd });
        
        for (let rescanBlock = rescanStart; rescanBlock <= rescanEnd; rescanBlock++) {
          
          const chainBlock = await viemClient.getBlock(rescanBlock);
          if (chainBlock) {
            await this.processValidBlock(rescanBlock, chainBlock);
          }
        }
        return; // 重组处理完成，直接返回
      }

      // 批量分析交易（使用 bloom 过滤器优化）
      const deposits = await transactionAnalyzer.analyzeBatchBlocksForDeposits(startBlock, endBlock);

      // 批量保存区块信息
      const blockData = blocks.map(block => ({
        hash: block.data.hash!,
        parent_hash: block.data.parentHash,
        number: block.data.number!.toString(),
        timestamp: Number(block.data.timestamp),
        status: 'confirmed'
      }));

      // 准备批量存款数据
      const depositData = await transactionAnalyzer.prepareBatchDepositsData(deposits);

      // 使用远程事务批量处理区块和存款
      const success = await this.dbGatewayClient.processBlocksAndDepositsInTransaction(blockData, depositData);

      if (!success) {
        throw new Error(`批量处理区块和存款失败: ${startBlock}-${endBlock}`);
      }

      // 处理确认（这个可以在事务外进行）
      await confirmationManager.processConfirmations();

      logger.debug('批量区块扫描远程事务提交成功', {
        startBlock,
        endBlock,
        blocksProcessed: blocks.length,
        depositsProcessed: deposits.length
      });

    } catch (error) {
      logger.error('批量优化扫描失败，回退到逐个处理', { startBlock, endBlock, error });
      // 回退到逐个处理模式
      for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
        try {
          await this.scanSingleBlock(blockNumber);
        } catch (singleBlockError) {
          logger.error('逐个扫描区块失败', { blockNumber, error: singleBlockError });
          throw singleBlockError;
        }
      }
    }
  }

  /**
   * 历史分析模式扫描区块（适用于 finalized 区块，最高效）
   */
  private async scanBlockBatchHistorical(startBlock: number, endBlock: number): Promise<void> {
    try {
      logger.info('使用历史分析模式扫描 finalized 区块', { 
        startBlock, 
        endBlock,
        reason: 'endBlock已finalized，使用最优策略'
      });

      // 分步处理

      // 1. 批量获取并保存区块信息
      const blocks: any[] = [];
      for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
        const block = await viemClient.getBlock(blockNumber);
        if (!block) {
          throw new Error(`区块 ${blockNumber} 不存在`);
        }

        // 保存区块信息
        await this.dbGatewayClient.insertBlock({
          hash: block.hash!,
          parent_hash: block.parentHash,
          number: block.number!.toString(),
          timestamp: Number(block.timestamp),
          status: 'confirmed'
        });

        blocks.push({ number: blockNumber, data: block });
      }

      logger.debug('历史分析模式：区块信息保存完成', {
        startBlock,
        endBlock,
        blocksProcessed: blocks.length
      });

      // 2. 使用历史分析方法处理交易
      await transactionAnalyzer.analyzeHistoricalBlocks(startBlock, endBlock);

      // 3. 最后处理确认
      await confirmationManager.processConfirmations();

      logger.info('历史分析模式扫描完成', {
        startBlock,
        endBlock,
        blocksProcessed: blocks.length
      });

    } catch (error) {
      logger.error('历史分析模式扫描失败，回退到批量优化模式', { 
        startBlock, 
        endBlock, 
        error 
      });
      // 回退到批量优化模式
      await this.scanBlockBatch(startBlock, endBlock);
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
   * 处理有效区块 - 使用事务确保数据一致性
   */
  private async processValidBlock(blockNumber: number, block: any): Promise<void> {
    try {
      // 分析区块中的交易
      const deposits = await transactionAnalyzer.analyzeBlock(blockNumber);

      // 处理所有数据库写入操作
      // 1. 保存区块信息
      await this.dbGatewayClient.insertBlock({
        hash: block.hash!,
        parent_hash: block.parentHash,
        number: block.number!.toString(),
        timestamp: Number(block.timestamp),
        status: 'confirmed'
      });

      // 2. 处理检测到的存款
      for (const deposit of deposits) {
        await transactionAnalyzer.processDeposit(deposit);
      }

      // 3. 处理交易确认
      await confirmationManager.processConfirmations();

      logger.debug('区块处理完成', {
        blockNumber,
        hash: block.hash,
        deposits: deposits.length
      });

      logger.debug('区块扫描完成', {
        blockNumber,
        hash: block.hash,
        transactions: block.transactions.length,
        deposits: deposits.length
      });

    } catch (error) {
      logger.error('处理有效区块失败', { 
        blockNumber, 
        blockHash: block.hash,
        error 
      });
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
      const reorgStats = await reorgHandler.getReorgStats();

      // 获取待确认交易数量（confirmed 和 safe 状态的交易）
      const pendingTxResult = await database.get(`
        SELECT COUNT(*) as count
        FROM transactions
        WHERE status IN ('confirmed', 'safe')
      `);
      const pendingTransactions = pendingTxResult?.count || 0;

      const isUpToDate = lastScannedBlock >= latestBlock;

      return {
        currentBlock: lastScannedBlock,
        latestBlock,
        isUpToDate,
        scannedBlocks: lastScannedBlock,
        pendingTransactions,
        reorgStats
      };

    } catch (error) {
      logger.error('获取扫描进度失败', { error });
      throw error;
    }
  }

}

export const blockScanner = new BlockScanner();