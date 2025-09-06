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
      this.db = new sqlite3.Database(this.dbPath, (err: Error | null) => {
        if (err) {
          console.error('数据库连接错误:', err.message);
          reject(err);
        } else {
          console.log('已连接到SQLite数据库');
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

    return new Promise((resolve, reject) => {
      // 创建用户表
      this.db!.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        status INTEGER DEFAULT 0,
        kyc_status INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login_at DATETIME
      )`, (err) => {
        if (err) {
          reject(err);
          return;
        }

        // 创建钱包表
        this.db!.run(`CREATE TABLE IF NOT EXISTS wallets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER UNIQUE NOT NULL,
          address TEXT UNIQUE NOT NULL,
          device TEXT,
          path TEXT,
          chain_type TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )`, (err) => {
          if (err) {
            reject(err);
            return;
          }

          // 创建交易记录表
          this.db!.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            block_hash TEXT,
            block_no INTEGER,
            tx_hash TEXT UNIQUE NOT NULL,
            from_addr TEXT NOT NULL,
            to_addr TEXT NOT NULL,
            token_addr TEXT,
            amount REAL NOT NULL,
            fee REAL,
            type TEXT CHECK(type IN ('deposit', 'withdraw', 'collect', 'rebalance')),
            status TEXT CHECK(status IN ('pending', 'confirmed', 'failed')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`, (err) => {
            if (err) {
              reject(err);
              return;
            }

            // 创建用户余额表
            this.db!.run(`CREATE TABLE IF NOT EXISTS balances (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              address TEXT NOT NULL,
              token_symbol TEXT NOT NULL,
              address_type INTEGER DEFAULT 0,
              balance TEXT NOT NULL,
              lock_balance TEXT DEFAULT '0',
              timestamp INTEGER NOT NULL,
              FOREIGN KEY (user_id) REFERENCES users (id)
            )`, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          });
        });
      });
    });
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
