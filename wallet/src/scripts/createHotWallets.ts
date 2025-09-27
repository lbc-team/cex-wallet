import { getDatabase } from '../db/connection';
import { HotWalletService } from '../services/hotWalletService';


// 简单的日志函数
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || '')
};

// 热钱包配置
const hotWalletConfigs = [
  // 以太坊主网
  { chainType: 'evm' as const, chainId: 1, initialNonce: 0 },
  // 以太坊测试网
  { chainType: 'evm' as const, chainId: 11155111, initialNonce: 0 },
  // BSC 主网
  { chainType: 'evm' as const, chainId: 56, initialNonce: 0 },
  // BSC 测试网
  { chainType: 'evm' as const, chainId: 97, initialNonce: 0 },
  // 本地测试网络
  { chainType: 'evm' as const, chainId: 31337, initialNonce: 0 },
];

/**
 * 创建热钱包
 */
async function createHotWallet(params: {
  chainType: 'evm' | 'btc' | 'solana';
  chainId: number;
  initialNonce?: number;
}): Promise<{ success: boolean; walletId?: number; walletData?: any; error?: string }> {
  const db = getDatabase();
  const hotWalletService = new HotWalletService(db);
  
  try {
    logger.info('开始创建热钱包...', params);
    
    const result = await hotWalletService.createHotWallet(params);
    
    logger.info('热钱包创建成功:', {
      walletId: result.walletId,
      address: result.address,
      device: result.device,
      path: result.path
    });

    return {
      success: true,
      walletId: result.walletId,
      walletData: result
    };

  } catch (error) {
    logger.error('创建热钱包失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

/**
 * 列出热钱包
 */
async function listHotWallets(chainId?: number): Promise<void> {
  const db = getDatabase();
  
  try {
    const wallets = await db.getAvailableWallets(
      'evm', 
      'hot'
    );
    
    logger.info(`热钱包列表 (链ID: ${chainId || 1}):`, {
      count: wallets.length,
      wallets: wallets.map((w: any) => ({
        id: w.id,
        address: w.address,
        walletType: w.wallet_type,
        nonce: w.nonce,
        isActive: w.is_active,
        device: w.device
      }))
    });

  } catch (error) {
    logger.error('获取热钱包列表失败:', error);
  }
}

/**
 * 批量创建热钱包
 */
async function createHotWallets() {
  logger.info('开始批量创建热钱包...', { count: hotWalletConfigs.length });
  
  let successCount = 0;
  let failCount = 0;
  const errors: string[] = [];

  for (const config of hotWalletConfigs) {
    try {
      logger.info(`创建热钱包: 链ID ${config.chainId}, 类型 ${config.chainType}`);
      
      const result = await createHotWallet({
        chainType: config.chainType,
        chainId: config.chainId,
        initialNonce: config.initialNonce || 0
      });

      if (result.success) {
        successCount++;
        logger.info(`✅ 热钱包创建成功: 链ID ${config.chainId}`, {
          walletId: result.walletId,
          address: result.walletData?.address
        });
      } else {
        failCount++;
        const error = result.error || '未知错误';
        errors.push(`链ID ${config.chainId}: ${error}`);
        logger.error(`❌ 热钱包创建失败: 链ID ${config.chainId}`, error);
      }

      // 添加延迟避免请求过快
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      failCount++;
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      errors.push(`链ID ${config.chainId}: ${errorMsg}`);
      logger.error(`❌ 热钱包创建异常: 链ID ${config.chainId}`, error);
    }
  }

  // 显示结果统计
  logger.info('批量创建热钱包完成', {
    总数: hotWalletConfigs.length,
    成功: successCount,
    失败: failCount,
    成功率: `${((successCount / hotWalletConfigs.length) * 100).toFixed(1)}%`
  });

  if (errors.length > 0) {
    logger.warn('失败详情:', errors);
  }

  // 显示创建的热钱包列表
  logger.info('显示所有热钱包...');
  await listHotWallets();
}

// 如果直接运行此脚本
if (require.main === module) {
  createHotWallets()
    .then(() => {
      logger.info('批量创建热钱包脚本执行完成');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('批量创建热钱包脚本执行失败:', error);
      process.exit(1);
    });
}

export { createHotWallets, createHotWallet, listHotWallets };
