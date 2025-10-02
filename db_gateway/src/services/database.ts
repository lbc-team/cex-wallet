import sqlite3 from 'sqlite3';
import { join, resolve, isAbsolute } from 'path';
import { logger } from '../utils/logger';

export class DatabaseService {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor() {
    // If WALLET_DB_PATH is absolute, use it directly
    // Otherwise, treat it as relative to the project root (db_gateway directory)
    if (process.env.WALLET_DB_PATH) {
      this.dbPath = isAbsolute(process.env.WALLET_DB_PATH)
        ? process.env.WALLET_DB_PATH
        : resolve(process.cwd(), process.env.WALLET_DB_PATH);
    } else {
      // Default: wallet.db in db_gateway directory
      this.dbPath = resolve(process.cwd(), 'wallet.db');
    }
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
          logger.error('Database connection failed', { path: this.dbPath, error: err.message });
          reject(err);
        } else {
          logger.info('Database connected successfully', { path: this.dbPath });
          this.setupPragmas()
            .then(() => this.initDatabase())
            .then(resolve)
            .catch(reject);
        }
      });
    });
  }

  private async setupPragmas(): Promise<void> {
    if (!this.db) return;

    const pragmas = [
      'PRAGMA journal_mode=WAL',
      'PRAGMA busy_timeout=30000',
      'PRAGMA synchronous=NORMAL',
      'PRAGMA cache_size=1000'
    ];

    for (const pragma of pragmas) {
      await this.run(pragma);
    }
  }

  private async initDatabase(): Promise<void> {
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      logger.info('开始初始化数据库表...');

      // 创建用户表
      await this.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE,
          phone TEXT,
          password_hash TEXT,
          user_type TEXT DEFAULT 'normal',
          status INTEGER DEFAULT 0,
          kyc_status INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_login_at DATETIME
        )
      `);

      // 创建钱包表
      await this.run(`
        CREATE TABLE IF NOT EXISTS wallets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,                    -- 用户ID，系统钱包
          address TEXT UNIQUE NOT NULL,      -- 钱包地址，唯一
          device TEXT,                       -- 来自哪个签名机设备地址
          path TEXT,                         -- 推导路径
          chain_type TEXT NOT NULL,         -- 地址类型：evm、btc、solana
          wallet_type TEXT NOT NULL,         -- 钱包类型：user、hot、multisig、cold、vault
          is_active INTEGER DEFAULT 1,      -- 是否激活：0-未激活，1-激活
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // 创建区块表（scan 服务需要）
      await this.run(`
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

      // 创建交易表（scan 服务需要）
      await this.run(`
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
          status TEXT DEFAULT 'confirmed',
          confirmation_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建代币表（scan 服务需要）
      await this.run(`
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
          withdraw_fee TEXT DEFAULT '0',
          min_withdraw_amount TEXT DEFAULT '0',
          status INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建资金 Credits 流水表（替代直接更新 balances）
      await this.run(`
        CREATE TABLE IF NOT EXISTS credits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          address TEXT NOT NULL,
          token_id INTEGER NOT NULL,
          token_symbol TEXT NOT NULL,
          amount TEXT NOT NULL,
          credit_type TEXT NOT NULL,
          business_type TEXT NOT NULL,
          reference_id TEXT NOT NULL,
          reference_type TEXT NOT NULL,
          chain_id INTEGER,
          chain_type TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          block_number INTEGER,
          tx_hash TEXT,
          event_index INTEGER DEFAULT 0,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (token_id) REFERENCES tokens(id)
        )
      `);


      // 创建钱包 nonce 管理表
      await this.run(`
        CREATE TABLE IF NOT EXISTS wallet_nonces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wallet_id INTEGER NOT NULL,        -- 关联 wallets.id
          chain_id INTEGER NOT NULL,        -- 链ID
          nonce INTEGER NOT NULL DEFAULT 0,  -- 当前 nonce 值
          last_used_at DATETIME,            -- 最后使用时间
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (wallet_id) REFERENCES wallets(id),
          UNIQUE(wallet_id, chain_id)       -- 每个钱包在每个链上只有一个nonce记录
        )
      `);

      // 创建 operation_id 跟踪表（用于防重放攻击）
      await this.run(`
        CREATE TABLE IF NOT EXISTS used_operation_ids (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          operation_id TEXT UNIQUE NOT NULL,
          used_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建提现记录表
      await this.run(`
        CREATE TABLE IF NOT EXISTS withdraws (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          to_address TEXT NOT NULL,
          token_id INTEGER NOT NULL,
          amount TEXT NOT NULL,
          fee TEXT NOT NULL DEFAULT '0',
          chain_id INTEGER NOT NULL,
          chain_type TEXT NOT NULL,
          from_address TEXT,
          tx_hash TEXT,
          gas_price TEXT,
          max_fee_per_gas TEXT,
          max_priority_fee_per_gas TEXT,
          gas_used TEXT,
          nonce INTEGER,
          status TEXT NOT NULL DEFAULT 'user_withdraw_request',
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (token_id) REFERENCES tokens(id)
        )
      `);

      // 创建索引
      await this.createIndexes();

      // 创建余额聚合视图
      await this.createBalanceViews();

      logger.info('数据库表初始化完成');

    } catch (error) {
      logger.error('数据库表初始化失败', { error });
      throw error;
    }
  }

  private async createIndexes(): Promise<void> {
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_blocks_number ON blocks(number)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_status ON blocks(status)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_block_hash ON transactions(block_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_to_addr ON transactions(to_addr)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)`,

      // Credits表索引
      `CREATE INDEX IF NOT EXISTS idx_credits_user_token ON credits(user_id, token_id)`,
      `CREATE INDEX IF NOT EXISTS idx_credits_user_status ON credits(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_credits_reference ON credits(reference_id, reference_type)`,
      `CREATE INDEX IF NOT EXISTS idx_credits_tx_hash ON credits(tx_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_credits_block_number ON credits(block_number)`,
      `CREATE INDEX IF NOT EXISTS idx_credits_status ON credits(status)`,
      `CREATE INDEX IF NOT EXISTS idx_credits_type ON credits(credit_type)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_credits_unique ON credits(user_id, reference_id, reference_type, event_index)`,

      `CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(address)`,
      `CREATE INDEX IF NOT EXISTS idx_tokens_chain_symbol ON tokens(chain_type, chain_id, token_symbol)`,
      `CREATE INDEX IF NOT EXISTS idx_tokens_chain_address ON tokens(chain_type, chain_id, token_address)`,
      `CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_unique ON tokens(chain_type, chain_id, token_address, token_symbol)`,

      // Wallets 表索引
      `CREATE INDEX IF NOT EXISTS idx_wallets_chain_type ON wallets(chain_type)`,
      `CREATE INDEX IF NOT EXISTS idx_wallets_type ON wallets(wallet_type)`,
      `CREATE INDEX IF NOT EXISTS idx_wallets_active ON wallets(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_wallets_user_type ON wallets(user_id, wallet_type)`,

      // Wallet nonces 表索引
      `CREATE INDEX IF NOT EXISTS idx_wallet_nonces_wallet ON wallet_nonces(wallet_id)`,
      `CREATE INDEX IF NOT EXISTS idx_wallet_nonces_chain ON wallet_nonces(chain_id)`,
      `CREATE INDEX IF NOT EXISTS idx_wallet_nonces_last_used ON wallet_nonces(last_used_at)`,

      // Withdraws 表索引
      `CREATE INDEX IF NOT EXISTS idx_withdraws_user_id ON withdraws(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_withdraws_status ON withdraws(status)`,
      `CREATE INDEX IF NOT EXISTS idx_withdraws_chain ON withdraws(chain_id, chain_type)`,
      `CREATE INDEX IF NOT EXISTS idx_withdraws_tx_hash ON withdraws(tx_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_withdraws_created_at ON withdraws(created_at)`,

      // Used operation_ids 表索引
      `CREATE INDEX IF NOT EXISTS idx_operation_ids_id ON used_operation_ids(operation_id)`,
      `CREATE INDEX IF NOT EXISTS idx_operation_ids_expires_at ON used_operation_ids(expires_at)`
    ];

    for (const indexSql of indexes) {
      await this.run(indexSql);
    }
  }

  private async createBalanceViews(): Promise<void> {
    try {
      // 1. 用户余额实时视图（按地址分组）
      await this.run(`
        CREATE VIEW IF NOT EXISTS v_user_balances AS
        SELECT
          c.user_id,
          c.address,
          c.token_id,
          c.token_symbol,
          t.decimals,
          SUM(CASE
            WHEN c.credit_type NOT IN ('freeze') AND (
              (c.credit_type = 'deposit' AND c.status = 'finalized') OR
              (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
            )
            THEN CAST(c.amount AS REAL)
            ELSE 0
          END) as available_balance,
          SUM(CASE
            WHEN c.credit_type = 'freeze' AND c.status IN ('confirmed', 'finalized')
            THEN ABS(CAST(c.amount AS REAL))
            ELSE 0
          END) as frozen_balance,
          SUM(CASE
            WHEN (
              (c.credit_type = 'deposit' AND c.status = 'finalized') OR
              (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
            )
            THEN CAST(c.amount AS REAL)
            ELSE 0
          END) as total_balance,
          PRINTF('%.6f', SUM(CASE
            WHEN c.credit_type NOT IN ('freeze') AND (
              (c.credit_type = 'deposit' AND c.status = 'finalized') OR
              (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
            )
            THEN CAST(c.amount AS REAL)
            ELSE 0
          END) / POWER(10, t.decimals)) as available_balance_formatted,
          PRINTF('%.6f', SUM(CASE
            WHEN c.credit_type = 'freeze' AND c.status IN ('confirmed', 'finalized')
            THEN ABS(CAST(c.amount AS REAL))
            ELSE 0
          END) / POWER(10, t.decimals)) as frozen_balance_formatted,
          PRINTF('%.6f', SUM(CASE
            WHEN (
              (c.credit_type = 'deposit' AND c.status = 'finalized') OR
              (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
            )
            THEN CAST(c.amount AS REAL)
            ELSE 0
          END) / POWER(10, t.decimals)) as total_balance_formatted,
          MAX(c.updated_at) as last_updated
        FROM credits c
        JOIN tokens t ON c.token_id = t.id
        GROUP BY c.user_id, c.address, c.token_id, c.token_symbol, t.decimals
        HAVING total_balance > 0
      `);

      // 2. 用户代币总余额视图（跨地址聚合）
      await this.run(`
        CREATE VIEW IF NOT EXISTS v_user_token_totals AS
        SELECT
          c.user_id,
          c.token_id,
          c.token_symbol,
          t.decimals,
          SUM(CASE
            WHEN c.credit_type NOT IN ('freeze') AND (
              (c.credit_type = 'deposit' AND c.status = 'finalized') OR
              (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
            )
            THEN CAST(c.amount AS REAL)
            ELSE 0
          END) as total_available_balance,
          SUM(CASE
            WHEN c.credit_type = 'freeze' AND c.status IN ('confirmed', 'finalized')
            THEN ABS(CAST(c.amount AS REAL))
            ELSE 0
          END) as total_frozen_balance,
          SUM(CASE
            WHEN (
              (c.credit_type = 'deposit' AND c.status = 'finalized') OR
              (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
            )
            THEN CAST(c.amount AS REAL)
            ELSE 0
          END) as total_balance,
          PRINTF('%.6f', SUM(CASE
            WHEN c.credit_type NOT IN ('freeze') AND (
              (c.credit_type = 'deposit' AND c.status = 'finalized') OR
              (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
            )
            THEN CAST(c.amount AS REAL)
            ELSE 0
          END) / POWER(10, t.decimals)) as total_available_formatted,
          PRINTF('%.6f', SUM(CASE
            WHEN c.credit_type = 'freeze' AND c.status IN ('confirmed', 'finalized')
            THEN ABS(CAST(c.amount AS REAL))
            ELSE 0
          END) / POWER(10, t.decimals)) as total_frozen_formatted,
          PRINTF('%.6f', SUM(CASE
            WHEN (
              (c.credit_type = 'deposit' AND c.status = 'finalized') OR
              (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
            )
            THEN CAST(c.amount AS REAL)
            ELSE 0
          END) / POWER(10, t.decimals)) as total_balance_formatted,
          COUNT(DISTINCT c.address) as address_count,
          MAX(c.updated_at) as last_updated
        FROM credits c
        JOIN tokens t ON c.token_id = t.id
        GROUP BY c.user_id, c.token_id, c.token_symbol, t.decimals
        HAVING total_balance > 0
      `);

      // 3. 用户余额统计视图
      await this.run(`
        CREATE VIEW IF NOT EXISTS v_user_balance_stats AS
        SELECT
          user_id,
          COUNT(DISTINCT token_id) as token_count,
          COUNT(DISTINCT address) as address_count,
          SUM(CASE WHEN total_balance > 0 THEN 1 ELSE 0 END) as positive_balance_count,
          MAX(last_updated) as last_balance_update
        FROM v_user_token_totals
        GROUP BY user_id
      `);

      logger.info('余额聚合视图创建完成');
    } catch (error) {
      logger.error('创建余额视图失败', { error });
      throw error;
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      logger.debug('Executing query', { sql, params });

      this.db.all(sql, params, (err: Error | null, rows: T[]) => {
        if (err) {
          logger.error('Query execution failed', { sql, params, error: err.message });
          reject(err);
        } else {
          logger.debug('Query executed successfully', { sql, params, rowCount: rows.length });
          resolve(rows);
        }
      });
    });
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      logger.debug('Executing single query', { sql, params });

      this.db.get(sql, params, (err: Error | null, row: T | undefined) => {
        if (err) {
          logger.error('Single query execution failed', { sql, params, error: err.message });
          reject(err);
        } else {
          logger.debug('Single query executed successfully', { sql, params, found: !!row });
          resolve(row);
        }
      });
    });
  }

  async run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      logger.debug('Executing run command', { sql, params });

      this.db.run(sql, params, function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          logger.error('Run command execution failed', { sql, params, error: err.message });
          reject(err);
        } else {
          logger.debug('Run command executed successfully', {
            sql,
            params,
            lastID: this.lastID,
            changes: this.changes
          });
          resolve(this);
        }
      });
    });
  }

  async beginTransaction(): Promise<void> {
    await this.run('BEGIN TRANSACTION');
  }

  async commit(): Promise<void> {
    await this.run('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.run('ROLLBACK');
  }

  async executeInTransaction<T>(operation: () => Promise<T>): Promise<T> {
    await this.beginTransaction();
    try {
      const result = await operation();
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  isConnected(): boolean {
    return this.db !== null;
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      this.db.close((err) => {
        if (err) {
          logger.error('Database close failed', { error: err.message });
          reject(err);
        } else {
          logger.info('Database connection closed');
          this.db = null;
          resolve();
        }
      });
    });
  }
}