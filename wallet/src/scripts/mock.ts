import 'dotenv/config';
import { getDbGatewayClient } from '../services/dbGatewayClient';
import { HotWalletService } from '../services/hotWalletService';
import { getDatabase } from '../db/connection';

// 简单的日志函数
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || '')
};

async function insertMockData() {
  try {
    const dbGateway = getDbGatewayClient();

    // 1. 初始化系统用户
    logger.info('初始化系统用户...');
    const systemUsers = [
      { username: 'hot_wallet1', email: 'hot_wallet1@internal', userType: 'sys_hot_wallet' },
      { username: 'hot_wallet2', email: 'hot_wallet2@internal', userType: 'sys_hot_wallet' },
      { username: 'multisig_wallet', email: 'multisig_wallets@internal', userType: 'sys_multisig' },
    ];

    for (const user of systemUsers) {
      try {
        // 先检查是否已存在
        const existing = await dbGateway.getUsers({ username: user.username });
        if (existing.length === 0) {
          await dbGateway.createUser({
            username: user.username,
            email: user.email,
            user_type: user.userType,
            status: 1
          });
          logger.info(`系统用户创建成功: ${user.username}`);
        } else {
          logger.info(`系统用户已存在: ${user.username}`);
        }
      } catch (error) {
        logger.warn(`创建系统用户失败 (${user.username}):`, error);
      }
    }
    logger.info('系统用户初始化完成');

    // 2. 插入普通用户数据
    logger.info('插入普通用户数据...');
    for (let i = 1; i <= 10; i++) {
      try {
        const username = `test_user_${i}`;
        const existing = await dbGateway.getUsers({ username });

        if (existing.length === 0) {
          await dbGateway.createUser({
            username,
            email: `test${i}@test.com`,
            phone: `1234567890${i}`,
            password_hash: `hash_${i}_12345`,
            user_type: 'normal',
            status: 1,
            kyc_status: 1
          });
          logger.info(`普通用户创建成功: ${username}`);
        } else {
          logger.info(`普通用户已存在: ${username}`);
        }
      } catch (error) {
        logger.warn(`创建普通用户失败 (test_user_${i}):`, error);
      }
    }
    logger.info('普通用户数据插入完成');

    // 3. 创建热钱包
    logger.info('创建热钱包...');
    const db = getDatabase();
    await db.connect();
    const hotWalletService = new HotWalletService(db);
    try {
      const hotWallet = await hotWalletService.createHotWallet({
        chainType: 'evm'
      });

      logger.info('热钱包创建成功:', {
        walletId: hotWallet.walletId,
        address: hotWallet.address,
        device: hotWallet.device,
        path: hotWallet.path
      });
    } catch (error) {
      logger.error('创建热钱包失败:', error);
    }

    // 4. 插入代币配置
    logger.info('插入代币配置...');

    // 本地测试网络 (chain_id: 31337) - Anvil/Hardhat/Localhost
    // ETH: withdraw_fee = 0.0001 ETH, min_withdraw_amount = 0.001 ETH (10倍)
    try {
      const existingETH = await dbGateway.getTokens({
        chain_id: 31337,
        token_symbol: 'ETH'
      });

      if (existingETH.length === 0) {
        await dbGateway.createToken({
          chain_type: 'eth',
          chain_id: 31337,
          token_address: '0x0000000000000000000000000000000000000000',
          token_symbol: 'ETH',
          token_name: 'ETH',
          decimals: 18,
          is_native: true,
          collect_amount: '100000000000000',
          withdraw_fee: '100000000000000',
          min_withdraw_amount: '1000000000000000',
          status: 1
        });
        logger.info('ETH 代币配置创建成功');
      } else {
        logger.info('ETH 代币配置已存在');
      }
    } catch (error) {
      logger.warn('创建 ETH 代币配置失败:', error);
    }

    // 测试代币1: OPS - withdraw_fee = 2 OPS, min_withdraw_amount = 20 OPS (10倍)
    try {
      const existingOPS = await dbGateway.getTokens({
        chain_id: 31337,
        token_symbol: 'OPS'
      });

      if (existingOPS.length === 0) {
        await dbGateway.createToken({
          chain_type: 'eth',
          chain_id: 31337,
          token_address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
          token_symbol: 'OPS',
          token_name: 'OPS',
          decimals: 18,
          is_native: false,
          collect_amount: '10000000000000000000',
          withdraw_fee: '2000000000000000000',
          min_withdraw_amount: '20000000000000000000',
          status: 1
        });
        logger.info('OPS 代币配置创建成功');
      } else {
        logger.info('OPS 代币配置已存在');
      }
    } catch (error) {
      logger.warn('创建 OPS 代币配置失败:', error);
    }

    // 测试代币2: USDT - withdraw_fee = 0.5 USDT, min_withdraw_amount = 5 USDT (10倍)
    try {
      const existingUSDT = await dbGateway.getTokens({
        chain_id: 31337,
        token_symbol: 'USDT'
      });

      if (existingUSDT.length === 0) {
        await dbGateway.createToken({
          chain_type: 'eth',
          chain_id: 31337,
          token_address: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
          token_symbol: 'USDT',
          token_name: 'MockU',
          decimals: 18,
          is_native: false,
          collect_amount: '10000000000000000000',
          withdraw_fee: '500000000000000000',
          min_withdraw_amount: '5000000000000000000',
          status: 1
        });
        logger.info('USDT 代币配置创建成功');
      } else {
        logger.info('USDT 代币配置已存在');
      }
    } catch (error) {
      logger.warn('创建 USDT 代币配置失败:', error);
    }

    logger.info('代币配置插入完成');

    // 5. 通过 API 创建用户钱包地址
    logger.info('通过 API 创建用户钱包地址...');
    for (let i = 1; i <= 10; i++) {
      try {
        const response = await fetch(`http://localhost:3000/api/user/${i}/address?chain_type=evm`);
        const data = await response.json();

        if ((data as any).message && (data as any).data) {
          logger.info(`用户 ${i} 钱包创建成功:`, (data as any).data);
        } else {
          logger.warn(`用户 ${i} 钱包创建失败:`, data);
        }
      } catch (error) {
        logger.error(`用户 ${i} 钱包创建请求失败:`, error);
      }
    }

    // 6. 显示插入的数据
    const tokens = await dbGateway.getTokens({ chain_id: 31337 });
    logger.info('本地测试网络代币:', { count: tokens.length, tokens });

    const users = await dbGateway.getUsers({ user_type: 'normal' });
    logger.info('用户数据:', { count: users.length });

    const wallets = await dbGateway.getWallets({ user_id: 1 });
    logger.info('钱包数据:', { count: wallets.length });

    process.exit(0);

  } catch (error) {
    logger.error('插入示例数据失败', { error });
    process.exit(1);
  }
}

if (require.main === module) {
  insertMockData();
}

export { insertMockData };