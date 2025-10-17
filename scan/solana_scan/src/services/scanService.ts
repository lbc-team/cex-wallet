import { blockScanner } from './blockScanner';
import { transactionParser } from './txParser';
import { database } from '../db/connection';
import logger from '../utils/logger';
import config from '../config';

export interface ScanServiceStatus {
  isRunning: boolean;
  scanProgress: {
    currentSlot: number;
    latestSlot: number;
    isUpToDate: boolean;
    scannedSlots: number;
  };
  parserStats: {
    monitoredAddressCount: number;
    supportedTokenCount: number;
    lastAddressUpdate: number;
    lastTokenUpdate: number;
  };
}

export class ScanService {
  private isRunning: boolean = false;

  /**
   * 启动扫描服务
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('扫描服务已在运行');
      return;
    }

    try {
      logger.info('正在启动Solana扫描服务...');

      // 初始化数据库
      await database.initialize();

      // 加载监控地址和代币信息
      await transactionParser.refreshCache();

      // 启动区块扫描器
      await blockScanner.startScanning();

      this.isRunning = true;
      logger.info('Solana扫描服务启动成功', {
        startSlot: config.startSlot,
        scanBatchSize: config.scanBatchSize,
        confirmationThreshold: config.confirmationThreshold,
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
    await transactionParser.refreshCache();
  }

  /**
   * 获取服务状态
   */
  async getStatus(): Promise<ScanServiceStatus> {
    try {
      const scanProgress = await blockScanner.getScanProgress();
      const parserStats = transactionParser.getStats();

      return {
        isRunning: this.isRunning,
        scanProgress,
        parserStats
      };
    } catch (error) {
      logger.error('获取服务状态失败', { error });
      throw error;
    }
  }

  /**
   * 手动触发扫描
   */
  async triggerScan(): Promise<void> {
    if (!this.isRunning) {
      throw new Error('扫描服务未运行');
    }

    logger.info('手动触发扫描');
    await blockScanner.triggerScan();
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

      const issues: string[] = [];

      if (!status.isRunning) {
        issues.push('扫描服务未运行');
      }

      // 检查扫描延迟
      const scanDelay = status.scanProgress.latestSlot - status.scanProgress.currentSlot;
      if (scanDelay > 1000) {
        issues.push(`扫描延迟过大: ${scanDelay} 个槽位`);
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
    parserStats: any;
    systemInfo: any;
  }> {
    try {
      const status = await this.getStatus();

      return {
        scanProgress: status.scanProgress,
        parserStats: status.parserStats,
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
