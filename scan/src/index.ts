import { scanService } from './services/scanService';
import logger from './utils/logger';
import config from './config';

/**
 * 初始化应用
 */
async function initializeApp(): Promise<void> {
  try {
    logger.info('正在初始化CEX钱包扫描器...', {
      nodeVersion: process.version,
      platform: process.platform,
      config: {
        ethRpcUrl: config.ethRpcUrl ? '***' : '未配置',
        databaseUrl: config.databaseUrl,
        confirmationBlocks: config.confirmationBlocks,
        scanInterval: config.scanInterval
      }
    });

    // 自动启动扫描服务
    if (process.env.AUTO_START !== 'false') {
      logger.info('自动启动扫描服务...');
      await scanService.start();
    } else {
      logger.info('自动启动已禁用，需要手动启动扫描服务');
    }

    logger.info('CEX钱包扫描器启动完成');

    // 优雅关闭处理
    const gracefulShutdown = async (signal: string) => {
      logger.info(`收到 ${signal} 信号，开始优雅关闭...`);

      try {
        // 停止扫描服务
        await scanService.stop();
        logger.info('扫描服务已停止');
        process.exit(0);
      } catch (error) {
        logger.error('优雅关闭过程中出错', { error });
        process.exit(1);
      }
    };

    // 注册信号处理器
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // 处理未捕获的异常
    process.on('uncaughtException', (error) => {
      logger.error('未捕获的异常', { error });
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('未处理的Promise拒绝', { reason, promise });
      gracefulShutdown('UNHANDLED_REJECTION');
    });

    // 保持进程运行
    setInterval(() => {
      // 定期检查服务状态
      const memoryUsage = process.memoryUsage();
      logger.debug('进程状态检查', {
        uptime: process.uptime(),
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB'
        }
      });
    }, 5 * 60 * 1000); // 每5分钟检查一次

  } catch (error) {
    logger.error('初始化应用失败', { error });
    process.exit(1);
  }
}

// 启动应用
if (require.main === module) {
  initializeApp().catch((error) => {
    logger.error('应用启动失败', { error });
    process.exit(1);
  });
}

export { scanService };