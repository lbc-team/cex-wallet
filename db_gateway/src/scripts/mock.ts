import { getDatabase } from '../db/connection';
import { HotWalletService } from '../services/hotWalletService';

// 简单的日志函数
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || '')
};

async function insertMockData() {
  try {
    const db = getDatabase();
    await db.connect();

    // 1. 初始化系统用户
    logger.info('初始化系统用户...');
    const systemUsers = [
      { username: 'hot_wallet1', email: 'hot_wallet1@internal', userType: 'sys_hot_wallet' },
      { username: 'hot_wallet2', email: 'hot_wallet2@internal', userType: 'sys_hot_wallet' },
      { username: 'multisig_wallet', email: 'multisig_wallets@internal', userType: 'sys_multisig' },
    ];

    for (const user of systemUsers) {
      await db.run(`
        INSERT OR IGNORE INTO users (username, email, user_type, status, created_at, updated_at)
        VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [user.username, user.email, user.userType]);
    }
    logger.info('系统用户初始化完成');

    // 2. 插入普通用户数据
    logger.info('插入普通用户数据...');
    for (let i = 1; i <= 10; i++) {
      await db.run(`
        INSERT OR REPLACE INTO users (username, email, phone, password_hash, user_type, status, kyc_status) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        `test_user_${i}`,
        `test${i}@test.com`,
        `1234567890${i}`,
        `hash_${i}_12345`,
        'normal', // 普通用户类型
        1, // active status
        1  // verified kyc
      ]);
    }
    logger.info('普通用户数据插入完成');

    // 3. 创建热钱包
    logger.info('创建热钱包...');
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
    await db.run(`
      INSERT OR REPLACE INTO tokens (chain_type, chain_id, token_address, token_symbol, token_name, decimals, is_native, collect_amount, withdraw_fee, min_withdraw_amount, status) 
      VALUES ('eth', 31337, '0x0000000000000000000000000000000000000000', 'ETH', 'ETH', 18, 1, 100000000000000, 100000000000000, 1000000000000000, 1)
    `);
    
    // 测试代币1: OPS - withdraw_fee = 2 OPS, min_withdraw_amount = 20 OPS (10倍)
    await db.run(`
      INSERT OR REPLACE INTO tokens (chain_type, chain_id, token_address, token_symbol, token_name, decimals, is_native, collect_amount, withdraw_fee, min_withdraw_amount, status) 
      VALUES ('eth', 31337, '0x5FbDB2315678afecb367f032d93F642f64180aa3', 'OPS', 'OPS', 18, 0, 10000000000000000000, 2000000000000000000, 20000000000000000000, 1)
    `);
    
    // 测试代币2: USDT - withdraw_fee = 0.5 USDT, min_withdraw_amount = 5 USDT (10倍)
    await db.run(`
      INSERT OR REPLACE INTO tokens (chain_type, chain_id, token_address, token_symbol, token_name, decimals, is_native, collect_amount, withdraw_fee, min_withdraw_amount, status) 
      VALUES ('eth', 31337, '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0', 'USDT', 'MockU', 18, 0, 10000000000000000000, 500000000000000000, 5000000000000000000, 1)
    `);

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
    const tokens = await db.all(`SELECT * FROM tokens WHERE chain_id = 31337 ORDER BY token_symbol`);
    logger.info('本地测试网络代币:', { count: tokens.length, tokens });

    const users = await db.all(`SELECT id, username, user_type FROM users ORDER BY id`);
    logger.info('用户数据:', { count: users.length, users });

    const wallets = await db.all(`SELECT id, user_id, address, wallet_type FROM wallets ORDER BY id`);
    logger.info('钱包数据:', { count: wallets.length, wallets });
    
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