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
    const orderBy = options?.orderBy || 'timestamp';
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


}
