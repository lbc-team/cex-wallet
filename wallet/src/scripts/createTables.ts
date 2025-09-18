import { getDatabase } from '../db/connection';

// 简单的日志函数
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || '')
};

async function createTables() {
  try {
    logger.info('开始手动创建数据库表...');
    logger.warn('注意: 这个脚本是可选的，wallet 服务启动时会自动创建表');

    // 获取数据库实例
    const db = getDatabase();
    await db.connect();

    // 创建用户表
    await db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        phone TEXT,
        password_hash TEXT,
        status INTEGER DEFAULT 0,
        kyc_status INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login_at DATETIME
      )
    `);

    // 创建钱包表
    await db.run(`
      CREATE TABLE IF NOT EXISTS wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        address TEXT UNIQUE NOT NULL,
        device TEXT,
        path TEXT,
        chain_type TEXT DEFAULT 'evm',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // 创建区块表
    await db.run(`
      CREATE TABLE IF NOT EXISTS blocks (
        hash TEXT PRIMARY KEY,
        parent_hash TEXT,
        number TEXT NOT NULL,
        timestamp INTEGER,
        status TEXT DEFAULT 'confirmed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建交易表
    await db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        block_hash TEXT,
        block_no INTEGER,
        tx_hash TEXT UNIQUE NOT NULL,
        from_addr TEXT,
        to_addr TEXT,
        token_addr TEXT,
        amount TEXT,
        type TEXT,
        status TEXT DEFAULT 'pending',
        confirmation_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建代币表
    await db.run(`
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain_type TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        token_address TEXT,
        token_symbol TEXT NOT NULL,
        token_name TEXT,
        decimals INTEGER DEFAULT 18,
        is_native BOOLEAN DEFAULT 0,
        collect_amount TEXT DEFAULT '0',
        status INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建余额表
    await db.run(`
      CREATE TABLE IF NOT EXISTS balances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        address TEXT NOT NULL,
        chain_type TEXT NOT NULL,
        token_id INTEGER NOT NULL,
        token_symbol TEXT NOT NULL,
        address_type INTEGER DEFAULT 0,
        balance TEXT DEFAULT '0',
        locked_balance TEXT DEFAULT '0',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (token_id) REFERENCES tokens(id)
      )
    `);


    // 创建索引
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_blocks_number ON blocks(number)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_status ON blocks(status)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_block_hash ON transactions(block_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_to_addr ON transactions(to_addr)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)`,
      `CREATE INDEX IF NOT EXISTS idx_balances_user_chain_token ON balances(user_id, chain_type, token_id)`,
      `CREATE INDEX IF NOT EXISTS idx_balances_user_symbol ON balances(user_id, token_symbol)`,
      `CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(address)`,
      `CREATE INDEX IF NOT EXISTS idx_tokens_chain_symbol ON tokens(chain_type, chain_id, token_symbol)`,
      `CREATE INDEX IF NOT EXISTS idx_tokens_chain_address ON tokens(chain_type, chain_id, token_address)`,
      `CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_balances_unique ON balances(user_id, chain_type, token_id, address)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_unique ON tokens(chain_type, chain_id, token_address, token_symbol)`
    ];

    for (const indexSql of indexes) {
      await db.run(indexSql);
    }

    logger.info('数据库表创建完成');

    // 显示表结构
    const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table'`);
    logger.info('已创建的表', { tables: tables.map((t: any) => t.name) });

    process.exit(0);

  } catch (error) {
    logger.error('创建数据库表失败', { error });
    process.exit(1);
  }
}

if (require.main === module) {
  createTables();
}

export { createTables };
