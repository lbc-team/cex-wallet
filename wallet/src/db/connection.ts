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

      // 创建余额缓存表（用于高频查询优化）
      await this.run(`
        CREATE TABLE IF NOT EXISTS user_balance_cache (
          user_id INTEGER NOT NULL,
          token_id INTEGER NOT NULL,
          token_symbol TEXT NOT NULL,
          available_balance TEXT NOT NULL DEFAULT '0',
          frozen_balance TEXT NOT NULL DEFAULT '0',
          total_balance TEXT NOT NULL DEFAULT '0',
          last_credit_id INTEGER NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, token_id),
          FOREIGN KEY (user_id) REFERENCES users(id),
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
        
        // Credits表索引
        `CREATE INDEX IF NOT EXISTS idx_credits_user_token ON credits(user_id, token_id)`,
        `CREATE INDEX IF NOT EXISTS idx_credits_user_status ON credits(user_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_credits_reference ON credits(reference_id, reference_type)`,
        `CREATE INDEX IF NOT EXISTS idx_credits_tx_hash ON credits(tx_hash)`,
        `CREATE INDEX IF NOT EXISTS idx_credits_block_number ON credits(block_number)`,
        `CREATE INDEX IF NOT EXISTS idx_credits_status ON credits(status)`,
        `CREATE INDEX IF NOT EXISTS idx_credits_type ON credits(credit_type)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_credits_unique ON credits(reference_id, reference_type, event_index)`,
        
        `CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(address)`,
        `CREATE INDEX IF NOT EXISTS idx_tokens_chain_symbol ON tokens(chain_type, chain_id, token_symbol)`,
        `CREATE INDEX IF NOT EXISTS idx_tokens_chain_address ON tokens(chain_type, chain_id, token_address)`,
        `CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_unique ON tokens(chain_type, chain_id, token_address, token_symbol)`
      ];

      for (const indexSql of indexes) {
        await this.run(indexSql);
      }

      // 创建余额聚合视图
      await this.createBalanceViews();

      console.log('数据库表初始化完成');
      
    } catch (error) {
      console.error('数据库表初始化失败', error);
      throw error;
    }
  }

  // 创建余额聚合视图
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
            WHEN c.credit_type NOT IN ('freeze') AND c.status = 'finalized' 
            THEN CAST(c.amount AS REAL) 
            ELSE 0 
          END) as available_balance,
          SUM(CASE 
            WHEN c.credit_type = 'freeze' AND c.status = 'finalized' 
            THEN ABS(CAST(c.amount AS REAL))
            ELSE 0 
          END) as frozen_balance,
          SUM(CASE 
            WHEN c.status = 'finalized' 
            THEN CAST(c.amount AS REAL) 
            ELSE 0 
          END) as total_balance,
          PRINTF('%.6f', SUM(CASE 
            WHEN c.credit_type NOT IN ('freeze') AND c.status = 'finalized' 
            THEN CAST(c.amount AS REAL) 
            ELSE 0 
          END) / POWER(10, t.decimals)) as available_balance_formatted,
          PRINTF('%.6f', SUM(CASE 
            WHEN c.credit_type = 'freeze' AND c.status = 'finalized' 
            THEN ABS(CAST(c.amount AS REAL))
            ELSE 0 
          END) / POWER(10, t.decimals)) as frozen_balance_formatted,
          PRINTF('%.6f', SUM(CASE 
            WHEN c.status = 'finalized' 
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
            WHEN c.credit_type NOT IN ('freeze') AND c.status = 'finalized' 
            THEN CAST(c.amount AS REAL) 
            ELSE 0 
          END) as total_available_balance,
          SUM(CASE 
            WHEN c.credit_type = 'freeze' AND c.status = 'finalized' 
            THEN ABS(CAST(c.amount AS REAL))
            ELSE 0 
          END) as total_frozen_balance,
          SUM(CASE 
            WHEN c.status = 'finalized' 
            THEN CAST(c.amount AS REAL) 
            ELSE 0 
          END) as total_balance,
          PRINTF('%.6f', SUM(CASE 
            WHEN c.credit_type NOT IN ('freeze') AND c.status = 'finalized' 
            THEN CAST(c.amount AS REAL) 
            ELSE 0 
          END) / POWER(10, t.decimals)) as total_available_formatted,
          PRINTF('%.6f', SUM(CASE 
            WHEN c.credit_type = 'freeze' AND c.status = 'finalized' 
            THEN ABS(CAST(c.amount AS REAL))
            ELSE 0 
          END) / POWER(10, t.decimals)) as total_frozen_formatted,
          PRINTF('%.6f', SUM(CASE 
            WHEN c.status = 'finalized' 
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

      console.log('余额聚合视图创建完成');
    } catch (error) {
      console.error('创建余额视图失败', error);
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

  // 通过代币符号查找代币信息
  async findTokenBySymbol(symbol: string, chainId: number): Promise<{
    id: number;
    chain_type: string;
    chain_id: number;
    token_address: string | null;
    token_symbol: string;
    token_name: string | null;
    decimals: number;
    is_native: boolean;
  } | null> {
    const result = await this.queryOne(
      'SELECT * FROM tokens WHERE token_symbol = ? AND chain_id = ? AND status = 1 LIMIT 1',
      [symbol, chainId]
    );
    return result || null;
  }

  // 通过代币地址查找代币信息
  async findTokenByAddress(address: string): Promise<{
    id: number;
    chain_type: string;
    chain_id: number;
    token_address: string | null;
    token_symbol: string;
    token_name: string | null;
    decimals: number;
    is_native: boolean;
  } | null> {
    const result = await this.queryOne(
      'SELECT * FROM tokens WHERE token_address = ? AND status = 1 LIMIT 1',
      [address]
    );
    return result || null;
  }

  // ========== 内部钱包相关方法 ==========

  // 创建内部钱包
  async createInternalWallet(params: {
    address: string;
    device?: string;
    path?: string;
    chainType: string;
    chainId: number;
    walletType: 'hot' | 'multisig' | 'cold' | 'vault';
    nonce?: number;
  }): Promise<number> {
    const result = await this.run(`
      INSERT INTO internal_wallets (
        address, device, path, chain_type, chain_id, 
        wallet_type, nonce, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      params.address,
      params.device || null,
      params.path || null,
      params.chainType,
      params.chainId,
      params.walletType,
      params.nonce || 0
    ]);
    return result.lastID;
  }

  // 创建热钱包（通过签名机）
  async createHotWallet(params: {
    chainType: 'evm' | 'btc' | 'solana';
    chainId: number;
    initialNonce?: number;
  }): Promise<{
    walletId: number;
    address: string;
    device: string;
    path: string;
  }> {
    // 这个方法需要配合 SignerService 使用
    throw new Error('createHotWallet 方法需要配合 SignerService 使用');
  }

  // 获取内部钱包信息
  async getInternalWallet(address: string, chainId: number): Promise<{
    id: number;
    address: string;
    device: string | null;
    path: string | null;
    chain_type: string;
    chain_id: number;
    wallet_type: string;
    nonce: number;
    is_active: number;
    created_at: string;
    updated_at: string;
  } | null> {
    const result = await this.queryOne(
      'SELECT * FROM internal_wallets WHERE address = ? AND chain_id = ?',
      [address, chainId]
    );
    return result || null;
  }

  // 获取可用的内部钱包列表
  async getAvailableInternalWallets(chainId: number, chainType?: string, walletType?: string): Promise<{
    id: number;
    address: string;
    device: string | null;
    path: string | null;
    chain_type: string;
    chain_id: number;
    wallet_type: string;
    nonce: number;
    is_active: number;
    created_at: string;
    updated_at: string;
  }[]> {
    let sql = 'SELECT * FROM internal_wallets WHERE chain_id = ? AND is_active = 1';
    const params: any[] = [chainId];
    
    if (chainType) {
      sql += ' AND chain_type = ?';
      params.push(chainType);
    }
    
    if (walletType) {
      sql += ' AND wallet_type = ?';
      params.push(walletType);
    }
    
    sql += ' ORDER BY nonce ASC';
    
    return await this.query(sql, params);
  }

  // 原子性更新 nonce
  async atomicIncrementNonce(address: string, chainId: number, expectedNonce: number): Promise<{
    success: boolean;
    newNonce: number;
  }> {
    try {
      const result = await this.run(`
        UPDATE internal_wallets 
        SET nonce = nonce + 1, updated_at = CURRENT_TIMESTAMP
        WHERE address = ? AND chain_id = ? AND nonce = ?
      `, [address, chainId, expectedNonce]);
      
      if (result.changes === 0) {
        return {
          success: false,
          newNonce: expectedNonce
        };
      }
      
      return {
        success: true,
        newNonce: expectedNonce + 1
      };
    } catch (error) {
      console.error('原子性更新 nonce 失败:', error);
      return {
        success: false,
        newNonce: expectedNonce
      };
    }
  }

  // 获取当前 nonce
  async getCurrentNonce(address: string, chainId: number): Promise<number> {
    const result = await this.queryOne(
      'SELECT nonce FROM internal_wallets WHERE address = ? AND chain_id = ?',
      [address, chainId]
    );
    return result?.nonce || 0;
  }

  // 同步 nonce 从链上
  async syncNonceFromChain(address: string, chainId: number, chainNonce: number): Promise<boolean> {
    try {
      await this.run(`
        UPDATE internal_wallets 
        SET nonce = ?, updated_at = CURRENT_TIMESTAMP
        WHERE address = ? AND chain_id = ?
      `, [chainNonce, address, chainId]);
      return true;
    } catch (error) {
      console.error('同步 nonce 失败:', error);
      return false;
    }
  }

  // 激活/停用内部钱包
  async setInternalWalletActive(address: string, chainId: number, isActive: boolean): Promise<boolean> {
    try {
      await this.run(`
        UPDATE internal_wallets 
        SET is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE address = ? AND chain_id = ?
      `, [isActive ? 1 : 0, address, chainId]);
      return true;
    } catch (error) {
      console.error('设置内部钱包状态失败:', error);
      return false;
    }
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
