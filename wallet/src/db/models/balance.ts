import { DatabaseConnection } from '../connection';

// 用户余额接口定义
export interface Balance {
  id?: number;
  user_id: number;
  address: string;
  chain_type: string;
  token_id: number;
  token_symbol: string;
  address_type: 0 | 1 | 2; // 0:用户地址，1:热钱包地址(归集地址)，2:多签地址
  balance: string; // 大整数存储为字符串
  locked_balance: string; // 大整数存储为字符串
  created_at: string;
  updated_at: string;
}

// 创建余额请求接口
export interface CreateBalanceRequest {
  user_id: number;
  address: string;
  chain_type: string;
  token_id: number;
  token_symbol: string;
  address_type: 0 | 1 | 2;
  balance: string;
  locked_balance?: string;
}

// 余额更新接口
export interface UpdateBalanceRequest {
  balance?: string;
  locked_balance?: string;
}

// 余额查询选项
export interface BalanceQueryOptions {
  user_id?: number;
  address?: string;
  chain_type?: string;
  token_id?: number;
  token_symbol?: string;
  address_type?: 0 | 1 | 2;
  limit?: number | undefined;
  offset?: number | undefined;
  orderBy?: 'created_at' | 'balance' | 'token_symbol';
  orderDirection?: 'ASC' | 'DESC';
}

// 用户余额数据模型类
export class BalanceModel {
  private db: DatabaseConnection;

  constructor(database: DatabaseConnection) {
    this.db = database;
  }


  // 根据ID查找余额记录
  async findById(id: number): Promise<Balance | null> {
    const balance = await this.db.queryOne<Balance>(
      'SELECT * FROM balances WHERE id = ?',
      [id]
    );
    return balance || null;
  }

  // 根据用户ID和代币符号查找余额
  async findByUserAndToken(user_id: number, token_symbol: string): Promise<Balance[]> {
    return await this.db.query<Balance>(
      'SELECT * FROM balances WHERE user_id = ? AND token_symbol = ? ORDER BY timestamp DESC',
      [user_id, token_symbol]
    );
  }

  // 根据地址查找余额
  async findByAddress(address: string): Promise<Balance[]> {
    return await this.db.query<Balance>(
      'SELECT * FROM balances WHERE address = ? ORDER BY timestamp DESC',
      [address]
    );
  }

  // 获取钱包地址的余额总和
  async getTotalBalanceByAddress(address: string): Promise<number> {
    const result = await this.db.query<{ total_balance: number }>(
      'SELECT SUM(CAST(balance AS REAL)) as total_balance FROM balances WHERE address = ?',
      [address]
    );
    
    return result[0]?.total_balance || 0;
  }

  // 获取用户所有余额
  async findByUserId(user_id: number, options?: BalanceQueryOptions): Promise<Balance[]> {
    let sql = 'SELECT * FROM balances WHERE user_id = ?';
    const params: any[] = [user_id];

    // 添加过滤条件
    if (options?.token_symbol) {
      sql += ' AND token_symbol = ?';
      params.push(options.token_symbol);
    }

    if (options?.address_type !== undefined) {
      sql += ' AND address_type = ?';
      params.push(options.address_type);
    }

    // 添加排序
    const orderBy = options?.orderBy || 'created_at';
    const orderDirection = options?.orderDirection || 'DESC';
    sql += ` ORDER BY ${orderBy} ${orderDirection}`;

    // 添加分页
    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      
      if (options?.offset) {
        sql += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    return await this.db.query<Balance>(sql, params);
  }

  // 获取用户各代币总余额（所有链的总和，处理decimals并格式化）
  async getUserTotalBalancesByToken(user_id: number): Promise<{
    token_symbol: string;
    total_balance: string;
    chain_count: number;
  }[]> {
    const sql = `
      SELECT 
        b.token_symbol,
        SUM(CAST(b.balance AS REAL) / POWER(10, t.decimals)) as normalized_total,
        COUNT(DISTINCT b.chain_type) as chain_count
      FROM balances b
      JOIN tokens t ON b.token_id = t.id
      WHERE b.user_id = ? 
      GROUP BY b.token_symbol 
      HAVING normalized_total > 0
      ORDER BY normalized_total DESC
    `;
    
    const rows = await this.db.query<{
      token_symbol: string;
      normalized_total: number;
      chain_count: number;
    }>(sql, [user_id]);

    return rows.map(row => ({
      token_symbol: row.token_symbol,
      total_balance: row.normalized_total.toFixed(6),
      chain_count: row.chain_count
    }));
  }

  // 获取用户指定代币的详细余额信息（处理不同链的decimals并格式化）
  async getUserTokenBalance(user_id: number, token_symbol: string): Promise<{
    token_symbol: string;
    chain_details: {
      chain_type: string;
      token_id: number;
      balance: string;
      decimals: number;
      normalized_balance: string;
    }[];
    total_normalized_balance: string;
    chain_count: number;
  } | null> {
    const sql = `
      SELECT 
        b.token_symbol,
        b.chain_type,
        b.token_id,
        b.balance,
        t.decimals,
        CAST(b.balance AS REAL) / POWER(10, t.decimals) as normalized_balance
      FROM balances b
      JOIN tokens t ON b.token_id = t.id
      WHERE b.user_id = ? AND b.token_symbol = ?
      ORDER BY b.chain_type, normalized_balance DESC
    `;
    
    const rows = await this.db.query<{
      token_symbol: string;
      chain_type: string;
      token_id: number;
      balance: string;
      decimals: number;
      normalized_balance: number;
    }>(sql, [user_id, token_symbol]);

    if (rows.length === 0) {
      return null;
    }

    // 计算总的标准化余额
    const totalNormalized = rows.reduce((sum, row) => {
      return sum + row.normalized_balance;
    }, 0);

    return {
      token_symbol: rows[0]!.token_symbol,
      chain_details: rows.map(row => ({
        chain_type: row.chain_type,
        token_id: row.token_id,
        balance: row.balance,
        decimals: row.decimals,
        normalized_balance: row.normalized_balance.toFixed(6)
      })),
      total_normalized_balance: totalNormalized.toFixed(6),
      chain_count: new Set(rows.map(row => row.chain_type)).size
    };
  }


}
