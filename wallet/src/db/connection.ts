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
        `CREATE INDEX IF NOT EXISTS idx_withdraws_created_at ON withdraws(created_at)`
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

  // 获取系统用户ID
  async getSystemUserId(userType: 'sys_hot_wallet' | 'sys_multisig'): Promise<number | null> {
    const result = await this.queryOne(
      'SELECT id FROM users WHERE user_type = ? LIMIT 1',
      [userType]
    );
    return result?.id || null;
  }

  // 获取没有钱包地址的系统用户ID
  async getSystemUserIdWithoutWallet(userType: 'sys_hot_wallet' | 'sys_multisig'): Promise<number | null> {
    const result = await this.queryOne(`
      SELECT u.id 
      FROM users u
      LEFT JOIN wallets w ON u.id = w.user_id
      WHERE u.user_type = ? AND w.id IS NULL
      LIMIT 1
    `, [userType]);
    return result?.id || null;
  }

  // ========== 钱包管理相关方法 ==========

  // 创建钱包
  async createWallet(params: {
    userId: number | null;  // null 表示系统钱包
    address: string;
    device?: string;
    path?: string;
    chainType: string;
    walletType: 'user' | 'hot' | 'multisig' | 'cold' | 'vault';
    isActive?: boolean;
  }): Promise<number> {
    const result = await this.run(`
      INSERT INTO wallets (
        user_id, address, device, path, chain_type, 
        wallet_type, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      params.userId,
      params.address,
      params.device || null,
      params.path || null,
      params.chainType,
      params.walletType,
      params.isActive !== false ? 1 : 0
    ]);
    return result.lastID;
  }

  // 获取钱包信息
  async getWallet(address: string): Promise<{
    id: number;
    user_id: number | null;
    address: string;
    device: string | null;
    path: string | null;
    chain_type: string;
    wallet_type: string;
    is_active: number;
    created_at: string;
    updated_at: string;
  } | null> {
    const result = await this.queryOne('SELECT * FROM wallets WHERE address = ?', [address]);
    return result || null;
  }

  // 获取可用的钱包列表
  async getAvailableWallets(chainType?: string, walletType?: string): Promise<{
    id: number;
    user_id: number | null;
    address: string;
    device: string | null;
    path: string | null;
    chain_type: string;
    wallet_type: string;
    is_active: number;
    created_at: string;
    updated_at: string;
  }[]> {
    let sql = 'SELECT * FROM wallets WHERE is_active = 1';
    const params: any[] = [];
    
    if (chainType) {
      sql += ' AND chain_type = ?';
      params.push(chainType);
    }
    
    if (walletType) {
      sql += ' AND wallet_type = ?';
      params.push(walletType);
    }
    
    sql += ' ORDER BY id ASC';
    
    return await this.query(sql, params);
  }

  // 激活/停用钱包
  async setWalletActive(address: string, isActive: boolean): Promise<boolean> {
    try {
      await this.run(`
        UPDATE wallets 
        SET is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE address = ?
      `, [isActive ? 1 : 0, address]);
      return true;
    } catch (error) {
      console.error('设置钱包状态失败:', error);
      return false;
    }
  }

  // ========== Nonce 管理相关方法 ==========

  // 创建或更新钱包 nonce
  async createOrUpdateWalletNonce(params: {
    walletId: number;
    chainId: number;
    nonce?: number;
  }): Promise<void> {
    await this.run(`
      INSERT OR REPLACE INTO wallet_nonces (
        wallet_id, chain_id, nonce, last_used_at, created_at, updated_at
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [params.walletId, params.chainId, params.nonce || 0]);
  }

  // 获取钱包 nonce
  async getWalletNonce(walletId: number, chainId: number): Promise<number> {
    const result = await this.queryOne(
      'SELECT nonce FROM wallet_nonces WHERE wallet_id = ? AND chain_id = ?',
      [walletId, chainId]
    );
    return result?.nonce || 0;
  }

  // 通过地址获取 nonce
  async getCurrentNonce(address: string, chainId: number): Promise<number> {
    const result = await this.queryOne(`
      SELECT wn.nonce 
      FROM wallet_nonces wn
      JOIN wallets w ON wn.wallet_id = w.id
      WHERE w.address = ? AND wn.chain_id = ?
    `, [address, chainId]);
    return result?.nonce || -1;
  }

  // 原子性更新 nonce
  async atomicIncrementNonce(address: string, chainId: number, expectedNonce: number): Promise<{
    success: boolean;
    newNonce: number;
  }> {
    try {
      const result = await this.run(`
        UPDATE wallet_nonces 
        SET nonce = nonce + 1, last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE wallet_id = (SELECT id FROM wallets WHERE address = ?) 
        AND chain_id = ? AND nonce = ?
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

  // 标记 nonce 已使用
  async markNonceUsed(address: string, chainId: number, nonce: number): Promise<boolean> {
    try {
      await this.run(`
        UPDATE wallet_nonces 
        SET last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE wallet_id = (SELECT id FROM wallets WHERE address = ?) 
        AND chain_id = ? AND nonce = ?
      `, [address, chainId, nonce]);
      return true;
    } catch (error) {
      console.error('标记 nonce 已使用失败:', error);
      return false;
    }
  }

  // 同步 nonce 从链上
  async syncNonceFromChain(address: string, chainId: number, chainNonce: number): Promise<boolean> {
    try {
      // 先尝试更新，如果记录不存在则插入
      const updateResult = await this.run(`
        UPDATE wallet_nonces 
        SET nonce = ?, updated_at = CURRENT_TIMESTAMP
        WHERE wallet_id = (SELECT id FROM wallets WHERE address = ?) 
        AND chain_id = ?
      `, [chainNonce, address, chainId]);
      
      // 如果没有更新任何记录，则插入新记录
      if (updateResult.changes === 0) {
        await this.run(`
          INSERT INTO wallet_nonces (wallet_id, chain_id, nonce, created_at, updated_at)
          SELECT id, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM wallets WHERE address = ?
        `, [chainId, chainNonce, address]);
      }
      
      return true;
    } catch (error) {
      console.error('同步 nonce 失败:', error);
      return false;
    }
  }

  // ==================== 提现相关方法 ====================

  /**
   * 创建提现记录
   */
  async createWithdraw(record: {
    userId: number;
    toAddress: string;
    tokenId: number;
    amount: string;
    fee: string;
    chainId: number;
    chainType: string;
    status?: string;
  }): Promise<number> {
    const result = await this.run(`
      INSERT INTO withdraws (
        user_id, to_address, token_id,
        amount, fee, chain_id, chain_type, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      record.userId, record.toAddress, record.tokenId,
      record.amount, record.fee, record.chainId, record.chainType, 
      record.status || 'user_withdraw_request'
    ]);
    
    return result.lastID;
  }

  /**
   * 更新提现状态
   */
  async updateWithdrawStatus(
    id: number, 
    status: string, 
    data?: {
      fromAddress?: string;
      txHash?: string;
      nonce?: number;
      gasUsed?: string;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      errorMessage?: string;
    }
  ): Promise<void> {
    const updates: string[] = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [status];
    
    if (data?.fromAddress) {
      updates.push('from_address = ?');
      params.push(data.fromAddress);
    }
    if (data?.txHash) {
      updates.push('tx_hash = ?');
      params.push(data.txHash);
    }
    if (data?.nonce) {
      updates.push('nonce = ?');
      params.push(data.nonce);
    }
    if (data?.gasUsed) {
      updates.push('gas_used = ?');
      params.push(data.gasUsed);
    }
    if (data?.gasPrice) {
      updates.push('gas_price = ?');
      params.push(data.gasPrice);
    }
    if (data?.maxFeePerGas) {
      updates.push('max_fee_per_gas = ?');
      params.push(data.maxFeePerGas);
    }
    if (data?.maxPriorityFeePerGas) {
      updates.push('max_priority_fee_per_gas = ?');
      params.push(data.maxPriorityFeePerGas);
    }
    if (data?.errorMessage) {
      updates.push('error_message = ?');
      params.push(data.errorMessage);
    }
    
    params.push(id);
    
    await this.run(`
      UPDATE withdraws 
      SET ${updates.join(', ')}
      WHERE id = ?
    `, params);
  }

  /**
   * 查询用户的提现记录
   */
  async getUserWithdraws(userId: number, status?: string): Promise<any[]> {
    let sql = 'SELECT * FROM withdraws WHERE user_id = ?';
    const params: any[] = [userId];
    
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    
    sql += ' ORDER BY created_at DESC';
    return await this.query(sql, params);
  }

  /**
   * 查询待处理的提现
   */
  async getPendingWithdraws(): Promise<any[]> {
    return await this.query(
      'SELECT * FROM withdraws WHERE status IN (?, ?, ?) ORDER BY created_at ASC',
      ['user_withdraw_request', 'signing', 'pending']
    );
  }

  /**
   * 根据提现ID查询提现记录
   */
  async getWithdrawById(id: number): Promise<any | null> {
    return await this.queryOne('SELECT * FROM withdraws WHERE id = ?', [id]);
  }

  /**
   * 根据提现ID查询关联的credit记录
   */
  async getCreditsByWithdrawId(withdrawId: number): Promise<any[]> {
    return await this.query(
      'SELECT * FROM credits WHERE reference_id = ? AND reference_type LIKE ?',
      [withdrawId, 'withdraw%']
    );
  }

  /**
   * 创建 credit 记录
   */
  async createCredit(record: {
    user_id: number;
    token_id: number;
    token_symbol: string;
    amount: string;
    chain_id: number;
    chain_type: string;
    reference_id: number;
    reference_type: string;
    address?: string;
    credit_type?: string;
    business_type?: string;
    status?: string;
  }): Promise<number> {
    const result = await this.run(`
      INSERT INTO credits (
        user_id, token_id, token_symbol, amount, chain_id, chain_type,
        reference_id, reference_type, address, credit_type, business_type, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      record.user_id, record.token_id, record.token_symbol, record.amount,
      record.chain_id, record.chain_type, record.reference_id, record.reference_type,
      record.address || '', record.credit_type || 'withdraw', record.business_type || 'withdraw',
      record.status || 'pending'
    ]);
    
    return result.lastID;
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
