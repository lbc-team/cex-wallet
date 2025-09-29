import sqlite3 from 'sqlite3';
import path from 'path';

// 数据库连接类
export class DatabaseConnection {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(__dirname, '../../../../db_gateway/wallet.db');
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
          
        }
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
    withdraw_fee: string;
    min_withdraw_amount: string;
  } | null> {
    const result = await this.queryOne(
      'SELECT id, chain_type, chain_id, token_address, token_symbol, token_name, decimals, is_native, withdraw_fee, min_withdraw_amount FROM tokens WHERE token_symbol = ? AND chain_id = ? AND status = 1 LIMIT 1',
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


  // ========== Nonce 管理相关方法 ==========

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
