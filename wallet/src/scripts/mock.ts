import { getDatabase } from '../db/connection';

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

    // 插入用户
    // 插入10条模拟用户数据，匹配wallets表中的user_id
    for (let i = 0; i < 10; i++) {
      await db.run(`
        INSERT OR REPLACE INTO users (id, username, email, phone, password_hash, status, kyc_status) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        i,
        `test_user_${i}`,
        `test${i}@test.com`,
        `1234567890${i}`,
        `hash_${i}_12345`,
        1, // active status
        1  // verified kyc
      ]);
    }

    logger.info('开始插入多链代币和余额示例数据...');

    //使用 http://localhost:3000/api/user/1/address?chain_type=evm 请求，来插入 10 个钱包地址
    for (let i = 0; i < 10; i++) {
        const response = await fetch(`http://localhost:3000/api/user/${i}/address?chain_type=evm`);
        const data = await response.json();
        console.log(data);
    }


    // 插入多链代币配置
    logger.info('插入代币配置...');

    // 本地测试网络 (chain_id: 31337) - Anvil/Hardhat/Localhost
    await db.run(`
      INSERT OR REPLACE INTO tokens (chain_type, chain_id, token_address, token_symbol, token_name, decimals, is_native, collect_amount, status) 
      VALUES ('eth', 31337, '0x0000000000000000000000000000000000000000', 'ETH', 'ETH', 18, 1, 100000000000000, 1)
    `);
    
    // 测试代币1: OPS
    await db.run(`
      INSERT OR REPLACE INTO tokens (chain_type, chain_id, token_address, token_symbol, token_name, decimals, is_native, collect_amount,status) 
      VALUES ('eth', 31337, '0x5FbDB2315678afecb367f032d93F642f64180aa3', 'OPS', 'OPS', 18, 0, 1000000000000000000, 1)
    `);
    
    // 测试代币2: USDT
    await db.run(`
      INSERT OR REPLACE INTO tokens (chain_type, chain_id, token_address, token_symbol, token_name, decimals, is_native, collect_amount, status) 
      VALUES ('eth', 31337, '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0', 'USDT', 'MockU', 18, 0, 10000000000000000000, 1)
    `);

    logger.info('代币配置插入完成');

    // 显示插入的代币
    const tokens = await db.all(`SELECT * FROM tokens WHERE chain_id = 31337 ORDER BY token_symbol`);
    logger.info('本地测试网络代币:', { count: tokens.length, tokens });
    
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