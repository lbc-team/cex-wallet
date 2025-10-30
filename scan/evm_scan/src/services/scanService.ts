import { blockScanner } from './blockScanner';
import { transactionAnalyzer } from './txAnalyzer';
import { database } from '../db/connection';
import logger from '../utils/logger';
import config from '../config';

export interface ScanServiceStatus {
  isRunning: boolean;
  scanProgress: {
    currentBlock: number;
    latestBlock: number;
    isUpToDate: boolean;
    scannedBlocks: number;
    pendingTransactions: number;
  };
  analyzerStats: {
    userAddressCount: number;
    supportedTokenCount: number;
    lastAddressUpdate: number;
    lastTokenUpdate: number;
  };
}

export class ScanService {
  private isRunning: boolean = false;

  constructor() {
  }

  /**
   * 启动扫描服务
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('扫描服务已在运行');
      return;
    }

    try {
      logger.info('正在启动扫描服务...');

      // 初始化数据库
      await database.initialize();

      // 加载用户地址和代币信息
      await transactionAnalyzer.refreshCache();

      // 启动区块扫描器
      await blockScanner.startScanning();

      this.isRunning = true;
      logger.info('扫描服务启动成功', {
        startBlock: config.startBlock,
        scanBatchSize: config.scanBatchSize,
        confirmationBlocks: config.confirmationBlocks,
        scanInterval: config.scanInterval
      });

    } catch (error) {
      logger.error('启动扫描服务失败', { error });
      await this.stop();
      throw error;
    }
  }

  /**
   * 停止扫描服务
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('正在停止扫描服务...');

    try {
      // 停止区块扫描器
      blockScanner.stopScanning();

      this.isRunning = false;
      logger.info('扫描服务已停止');

    } catch (error) {
      logger.error('停止扫描服务失败', { error });
    }
  }

  /**
   * 重启服务
   */
  async restart(): Promise<void> {
    logger.info('重启扫描服务');
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
    await this.start();
  }

  /**
   * 刷新缓存
   */
  async refreshCache(): Promise<void> {
    logger.info('刷新缓存');
    await transactionAnalyzer.refreshCache();
  }

  /**
   * 获取服务状态
   */
  async getStatus(): Promise<ScanServiceStatus> {
    try {
      const scanProgress = await blockScanner.getScanProgress();
      const analyzerStats = transactionAnalyzer.getStats();

      return {
        isRunning: this.isRunning,
        scanProgress,
        analyzerStats
      };

    } catch (error) {
      logger.error('获取服务状态失败', { error });
      throw error;
    }
  }


  /**
   * 补扫指定区块范围
   */
  async rescanBlocks(startBlock: number, endBlock: number): Promise<void> {
    try {
      logger.info('开始补扫区块', { startBlock, endBlock });

      if (startBlock > endBlock) {
        throw new Error('起始区块不能大于结束区块');
      }

      if (endBlock - startBlock > 1000) {
        throw new Error('一次最多只能补扫1000个区块');
      }

      // 分析历史区块
      await transactionAnalyzer.analyzeHistoricalBlocks(startBlock, endBlock);

      logger.info('补扫区块完成', { startBlock, endBlock });

    } catch (error) {
      logger.error('补扫区块失败', { startBlock, endBlock, error });
      throw error;
    }
  }

  /**
   * 获取健康状态
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'warning' | 'error';
    details: any;
  }> {
    try {
      const status = await this.getStatus();
      const now = Date.now();

      // 检查服务状态
      const issues: string[] = [];

      if (!status.isRunning) {
        issues.push('扫描服务未运行');
      }

      // 检查扫描延迟
      const scanDelay = status.scanProgress.latestBlock - status.scanProgress.currentBlock;
      if (scanDelay > 100) {
        issues.push(`扫描延迟过大: ${scanDelay} 个区块`);
      }

      // 检查待确认交易数量
      if (status.scanProgress.pendingTransactions > 1000) {
        issues.push(`待确认交易过多: ${status.scanProgress.pendingTransactions}`);
      }

      let healthStatus: 'healthy' | 'warning' | 'error' = 'healthy';
      if (issues.length > 0) {
        healthStatus = issues.some(issue => 
          issue.includes('未运行') || issue.includes('延迟过大')
        ) ? 'error' : 'warning';
      }

      return {
        status: healthStatus,
        details: {
          timestamp: now,
          issues,
          scanDelay,
          ...status
        }
      };

    } catch (error) {
      logger.error('获取健康状态失败', { error });
      return {
        status: 'error',
        details: {
          error: (error as Error).message
        }
      };
    }
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    scanProgress: any;
    analyzerStats: any;
    systemInfo: any;
  }> {
    try {
      const status = await this.getStatus();
      
      return {
        scanProgress: status.scanProgress,
        analyzerStats: status.analyzerStats,
        systemInfo: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          platform: process.platform
        }
      };

    } catch (error) {
      logger.error('获取统计信息失败', { error });
      throw error;
    }
  }

}

export const scanService = new ScanService();