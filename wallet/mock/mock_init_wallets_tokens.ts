import 'dotenv/config';
import { getDbGatewayClient } from '../src/services/dbGatewayClient';
import { HotWalletService } from '../src/services/hotWalletService';
import { getDatabase } from '../src/db/connection';
import { WalletModel } from '../src/db/models/wallet';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 模拟插入示例数据
 * 使用方法: npm run mock:init
 */

// 简单的日志函数
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || '')
};

async function insertMockData() {
  try {
    // 0. 健康检查：确保 wallet 服务正在运行
    logger.info('检查 wallet 服务健康状态...');
    try {
      const healthCheckUrl = 'http://localhost:3000/health';
      const response = await fetch(healthCheckUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5秒超时
      });

      if (!response.ok) {
        logger.error('Wallet 服务健康检查失败', {
          status: response.status,
          statusText: response.statusText
        });
        logger.error('请确保 wallet 服务正在运行 (端口: 3000)');
        logger.error('启动命令: cd wallet && npm run dev');
        process.exit(1);
      }

      logger.info('✓ Wallet 服务运行正常');
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.error('Wallet 服务健康检查超时 (5秒)');
      } else if (error.code === 'ECONNREFUSED') {
        logger.error('无法连接到 Wallet 服务 (端口: 3000)');
      } else {
        logger.error('Wallet 服务健康检查失败:', error.message);
      }
      logger.error('');
      logger.error('请确保 wallet 服务正在运行:');
      logger.error('  1. 打开新终端');
      logger.error('  2. cd /Users/emmett/openspace_code/cex-wallet/wallet');
      logger.error('  3. npm run dev');
      logger.error('');
      process.exit(1);
    }

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
          chain_type: 'evm',
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
          chain_type: 'evm',
          chain_id: 31337,
          token_address: '0x5fbdb2315678afecb367f032d93f642f64180aa3', // 统一使用小写
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
          chain_type: 'evm',
          chain_id: 31337,
          token_address: '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512', // 统一使用小写
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

    // Solana 本地测试网络 (chain_id: 900) - 从 deployed-tokens.json 读取
    logger.info('插入 Solana 代币配置...');
    try {
      const deployedTokensPath = path.join(__dirname, 'deployed-tokens.json');
      if (fs.existsSync(deployedTokensPath)) {
        const deployedTokens = JSON.parse(fs.readFileSync(deployedTokensPath, 'utf-8'));
        
        for (const token of deployedTokens.tokens) {
          const existingToken = await dbGateway.getTokens({
            chain_id: 900,  // Solana 本地测试网
            token_symbol: token.symbol
          });

          if (existingToken.length === 0) {
            await dbGateway.createToken({
              chain_type: 'solana',
              chain_id: 900,  // Solana 本地测试网
              token_address: token.mint,
              token_symbol: token.symbol,
              token_name: token.name,
              decimals: token.decimals,
              is_native: false,
              collect_amount: '1000000',  // 1 token (with 6 decimals)
              withdraw_fee: '100000',     // 0.1 token
              min_withdraw_amount: '1000000',  // 1 token
              status: 1
            });
            logger.info(`${token.symbol} (Solana) 代币配置创建成功`);
          } else {
            logger.info(`${token.symbol} (Solana) 代币配置已存在`);
          }
        }
      } else {
        logger.warn('deployed-tokens.json 文件不存在，跳过 Solana 代币配置');
      }
    } catch (error) {
      logger.warn('创建 Solana 代币配置失败:', error);
    }

    // 添加 Solana 原生代币 SOL
    try {
      const existingSOL = await dbGateway.getTokens({
        chain_id: 900,
        token_symbol: 'SOL'
      });

      if (existingSOL.length === 0) {
        await dbGateway.createToken({
          chain_type: 'solana',
          chain_id: 900,
          token_address: '',
          token_symbol: 'SOL',
          token_name: 'Solana',
          decimals: 9,
          is_native: true,
          collect_amount: '100000000',  // 0.1 SOL
          withdraw_fee: '5000000',      // 0.005 SOL
          min_withdraw_amount: '10000000',  // 0.01 SOL
          status: 1
        });
        logger.info('SOL 代币配置创建成功');
      } else {
        logger.info('SOL 代币配置已存在');
      }
    } catch (error) {
      logger.warn('创建 SOL 代币配置失败:', error);
    }

    logger.info('代币配置插入完成');

    // 5. 通过 API 创建用户钱包地址（EVM）
    logger.info('通过 API 创建用户钱包地址（EVM）...');
    for (let i = 1; i <= 10; i++) {
      try {
        const response = await fetch(`http://localhost:3000/api/user/${i}/address?chain_type=evm`);
        const data = await response.json();

        if ((data as any).message && (data as any).data) {
          logger.info(`用户 ${i} EVM 钱包创建成功:`, (data as any).data);
        } else {
          logger.warn(`用户 ${i} EVM 钱包创建失败:`, data);
        }
      } catch (error) {
        logger.error(`用户 ${i} EVM 钱包创建请求失败:`, error);
      }
    }

    // 6. 通过 API 创建用户 Solana 钱包地址
    logger.info('通过 API 创建用户 Solana 钱包地址...');
    for (let i = 1; i <= 10; i++) {
      try {
        const response = await fetch(`http://localhost:3000/api/user/${i}/address?chain_type=solana`);
        const data = await response.json();

        if ((data as any).message && (data as any).data) {
          logger.info(`用户 ${i} Solana 钱包创建成功:`, (data as any).data);
        } else {
          logger.warn(`用户 ${i} Solana 钱包创建失败:`, data);
        }
      } catch (error) {
        logger.error(`用户 ${i} Solana 钱包创建请求失败:`, error);
      }
    }

    // 7. 显示插入的数据
    const tokens = await dbGateway.getTokens({ chain_id: 31337 });
    logger.info('本地 EVM 测试网络代币:', { count: tokens.length });

    const solanaTokens = await dbGateway.getTokens({ chain_id: 900 });
    logger.info('本地 Solana 测试网络代币:', { count: solanaTokens.length });

    const users = await dbGateway.getUsers({ user_type: 'normal' });
    logger.info('用户数据:', { count: users.length });

    const wallets = await dbGateway.getWallets({ chain_type: "evm" });
    logger.info('EVM钱包数据:', { count: wallets.length });

    const solanaWallets = await dbGateway.getWallets({ chain_type: "solana" });
    logger.info('Solana钱包数据:', { count: solanaWallets.length });

    // 8. 获取所有生成的 ATA 账户数量
    const walletModel = new WalletModel(db);
    // 显示 ATA 账户统计信息
    const ataStats = await walletModel.getSolanaTokenAccountsStats();
    logger.info('ATA账户统计:', ataStats);

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