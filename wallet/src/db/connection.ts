import sqlite3 from 'sqlite3';
import path from 'path';

// 数据库连接类
export class DatabaseConnection {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(__dirname, '../../wallet.db');
  }

  // 连接数据库
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err: Error | null) => {
        if (err) {
          console.error('数据库连接错误:', err.message);
          reject(err);
        } else {
          console.log('已连接到SQLite数据库');
          
          // 启用 WAL 模式以支持并发读写
          this.db?.run('PRAGMA journal_mode=WAL', (walErr) => {
            if (walErr) {
              console.warn('启用WAL模式失败:', walErr.message);
            } else {
              console.log('WAL模式已启用');
            }
          });

          // 设置忙碌超时
          this.db?.run('PRAGMA busy_timeout=30000', (timeoutErr) => {
            if (timeoutErr) {
              console.warn('设置忙碌超时失败:', timeoutErr.message);
            }
          });
          
          this.initDatabase()
            .then(() => resolve())
            .catch(reject);
        }
      });
    });
  }

  // 初始化数据库表
  private async initDatabase(): Promise<void> {
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      console.log('开始初始化数据库表...');

      // 创建用户表
      await this.run(`
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
      await this.run(`
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
          amount REAL,
          fee REAL,
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
          status INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建余额表
      await this.run(`
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
        await this.run(indexSql);
      }

      console.log('数据库表初始化完成');
      
    } catch (error) {
      console.error('数据库表初始化失败', error);
      throw error;
    }
  }

  // 获取数据库实例
  getDatabase(): sqlite3.Database {
    if (!this.db) {
      throw new Error('数据库未连接');
    }
    return this.db;
  }

  // 关闭数据库连接
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      this.db.close((err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          console.log('数据库连接已关闭');
          this.db = null;
          resolve();
        }
      });
    });
  }

  // 执行查询
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未连接'));
        return;
      }

      this.db.all(sql, params, (err: Error | null, rows: T[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // 执行单行查询
  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未连接'));
        return;
      }

      this.db.get(sql, params, (err: Error | null, row: T | undefined) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // 执行插入/更新/删除
  async run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未连接'));
        return;
      }

      this.db.run(sql, params, function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve(this);
        }
      });
    });
  }

  // 查询多行
  async all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未连接'));
        return;
      }

      this.db.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // 查询单行
  async get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未连接'));
        return;
      }

      this.db.get(sql, params, (err: Error | null, row: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }
}

// 单例数据库连接实例
let dbConnection: DatabaseConnection | null = null;

// 获取数据库连接实例
export function getDatabase(): DatabaseConnection {
  if (!dbConnection) {
    dbConnection = new DatabaseConnection();
  }
  return dbConnection;
}

// 初始化数据库连接
export async function initDatabase(): Promise<DatabaseConnection> {
  const db = getDatabase();
  await db.connect();
  return db;
}
