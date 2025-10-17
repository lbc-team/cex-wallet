import { scanService } from './services/scanService';
import { database } from './db/connection';
import logger from './utils/logger';
import config from './config';

/**
 * 检查是否有钱包地址需要监控
 */
async function checkWalletAddresses(): Promise<void> {
  try {
    logger.info('检查钱包地址...');

    // 初始化数据库连接
    await database.initialize();

    // 查询所有活跃的Solana钱包地址
    const wallets = await database.all(`
      SELECT address, wallet_type, chain_type
      FROM wallets
      WHERE chain_type = 'solana' AND is_active = 1
    `);

    if (!wallets || wallets.length === 0) {
      logger.error('未找到需要监控的Solana钱包地址');
      throw new Error(
        '数据库中没有活跃的Solana钱包地址需要监控\n' +
        '请先在系统中创建Solana钱包地址后再启动扫描服务'
      );
    }

    logger.info('找到需要监控的Solana钱包地址', {
      totalWallets: wallets.length,
      walletTypes: [...new Set(wallets.map((w: any) => w.wallet_type))]
    });

    // 打印部分地址信息（用于调试）
    const sampleAddresses = wallets.slice(0, 3).map((w: any) => ({
      address: `${w.address.substring(0, 6)}...${w.address.substring(w.address.length - 4)}`,
      type: w.wallet_type
    }));

    logger.info('钱包地址示例', { sampleAddresses });
  } catch (error: any) {
    logger.error('检查钱包地址失败', { error: error.message });
    throw error;
  }
}

/**
 * 初始化应用
 */
async function initializeApp(): Promise<void> {
  try {
    logger.info('正在初始化CEX钱包Solana扫描器...', {
      nodeVersion: process.version,
      platform: process.platform,
      config: {
        solanaRpcUrl: config.solanaRpcUrl ? '***' : '未配置',
        databaseUrl: config.databaseUrl,
        confirmationThreshold: config.confirmationThreshold,
        scanInterval: config.scanInterval
      }
    });

    // 检查钱包地址
    await checkWalletAddresses();

    // 自动启动扫描服务
    if (process.env.AUTO_START !== 'false') {
      logger.info('自动启动扫描服务...');
      await scanService.start();
    } else {
      logger.info('自动启动已禁用，需要手动启动扫描服务');
    }

    logger.info('CEX钱包Solana扫描器启动完成');

    // 关闭处理
    const gracefulShutdown = async (signal: string) => {
      logger.info(`收到 ${signal} 信号，开始关闭...`);

      try {
        // 停止扫描服务
        await scanService.stop();
        logger.info('扫描服务已停止');

        // 关闭数据库连接
        await database.close();
        logger.info('数据库连接已关闭');

        process.exit(0);
      } catch (error) {
        logger.error('关闭过程中出错', { error });
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
