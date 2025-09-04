import { DatabaseConnection } from '../connection';

// 用户余额接口定义
export interface Balance {
  id?: number;
  user_id: number;
  address: string;
  token_symbol: string;
  address_type: 0 | 1 | 2; // 0:用户地址，1:热钱包地址(归集地址)，2:多签地址
  balance: string; // 大整数存储为字符串
  lock_balance: string; // 大整数存储为字符串
  timestamp: number;
}

// 创建余额请求接口
export interface CreateBalanceRequest {
  user_id: number;
  address: string;
  token_symbol: string;
  address_type: 0 | 1 | 2;
  balance: string;
  lock_balance?: string;
  timestamp?: number;
}

// 余额更新接口
export interface UpdateBalanceRequest {
  balance?: string;
  lock_balance?: string;
  timestamp?: number;
}

// 余额查询选项
export interface BalanceQueryOptions {
  user_id?: number;
  address?: string;
  token_symbol?: string;
  address_type?: 0 | 1 | 2;
  limit?: number | undefined;
  offset?: number | undefined;
  orderBy?: 'timestamp' | 'balance' | 'token_symbol';
  orderDirection?: 'ASC' | 'DESC';
}

// 用户余额数据模型类
export class BalanceModel {
  private db: DatabaseConnection;

  constructor(database: DatabaseConnection) {
    this.db = database;
  }

  // 创建新余额记录
  async create(balanceData: CreateBalanceRequest): Promise<Balance> {
    const { user_id, address, token_symbol, address_type, balance, lock_balance = '0', timestamp = Date.now() } = balanceData;
    
    const result = await this.db.run(
      'INSERT INTO balances (user_id, address, token_symbol, address_type, balance, lock_balance, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [user_id, address, token_symbol, address_type, balance, lock_balance, timestamp]
    );

    const newBalance = await this.findById(result.lastID);
    if (!newBalance) {
      throw new Error('创建余额记录后无法获取余额信息');
    }

    return newBalance;
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

  // 获取所有余额记录
  async findAll(options?: BalanceQueryOptions): Promise<Balance[]> {
    let sql = 'SELECT * FROM balances WHERE 1=1';
    const params: any[] = [];

    // 添加过滤条件
    if (options?.user_id) {
      sql += ' AND user_id = ?';
      params.push(options.user_id);
    }

    if (options?.address) {
      sql += ' AND address = ?';
      params.push(options.address);
    }

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

  // 更新余额
  async update(id: number, updateData: UpdateBalanceRequest): Promise<Balance> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updateData.balance !== undefined) {
      fields.push('balance = ?');
      values.push(updateData.balance);
    }

    if (updateData.lock_balance !== undefined) {
      fields.push('lock_balance = ?');
      values.push(updateData.lock_balance);
    }

    if (updateData.timestamp !== undefined) {
      fields.push('timestamp = ?');
      values.push(updateData.timestamp);
    }

    if (fields.length === 0) {
      throw new Error('没有要更新的字段');
    }

    values.push(id);

    const sql = `UPDATE balances SET ${fields.join(', ')} WHERE id = ?`;
    const result = await this.db.run(sql, values);

    if (result.changes === 0) {
      throw new Error('余额记录不存在或更新失败');
    }

    const updatedBalance = await this.findById(id);
    if (!updatedBalance) {
      throw new Error('更新后无法获取余额信息');
    }

    return updatedBalance;
  }

  // 更新钱包余额（根据地址和代币符号）
  async updateWalletBalance(address: string, token_symbol: string, balance: number, user_id: number = 1): Promise<void> {
    // 检查是否已有该地址的余额记录
    const existingBalances = await this.db.query(
      'SELECT * FROM balances WHERE address = ? AND token_symbol = ? LIMIT 1',
      [address, token_symbol]
    );
    const existingBalance = existingBalances[0];

    if (existingBalance) {
      // 更新现有余额记录
      await this.db.run(
        'UPDATE balances SET balance = ?, timestamp = ? WHERE id = ?',
        [balance.toString(), Date.now(), existingBalance.id]
      );
    } else {
      // 创建新的余额记录
      await this.db.run(
        'INSERT INTO balances (user_id, address, token_symbol, address_type, balance, lock_balance, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [user_id, address, token_symbol, 0, balance.toString(), '0', Date.now()]
      );
    }
  }

  // 删除余额记录
  async delete(id: number): Promise<void> {
    const result = await this.db.run('DELETE FROM balances WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      throw new Error('余额记录不存在或删除失败');
    }
  }

  // 检查余额记录是否存在
  async exists(id: number): Promise<boolean> {
    const result = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM balances WHERE id = ?',
      [id]
    );
    
    return (result?.count || 0) > 0;
  }

  // 获取用户余额统计
  async getUserBalanceStats(user_id: number): Promise<{
    totalTokens: number;
    totalBalance: string;
    totalLockBalance: string;
    tokens: Array<{
      token_symbol: string;
      total_balance: string;
      total_lock_balance: string;
      address_count: number;
    }>;
  }> {
    const result = await this.db.queryOne<{
      totalTokens: number;
      totalBalance: string;
      totalLockBalance: string;
    }>(`
      SELECT 
        COUNT(DISTINCT token_symbol) as totalTokens,
        SUM(CAST(balance AS INTEGER)) as totalBalance,
        SUM(CAST(lock_balance AS INTEGER)) as totalLockBalance
      FROM balances 
      WHERE user_id = ?
    `, [user_id]);

    const tokens = await this.db.query<{
      token_symbol: string;
      total_balance: string;
      total_lock_balance: string;
      address_count: number;
    }>(`
      SELECT 
        token_symbol,
        SUM(CAST(balance AS INTEGER)) as total_balance,
        SUM(CAST(lock_balance AS INTEGER)) as total_lock_balance,
        COUNT(*) as address_count
      FROM balances 
      WHERE user_id = ?
      GROUP BY token_symbol
      ORDER BY total_balance DESC
    `, [user_id]);

    return {
      totalTokens: result?.totalTokens || 0,
      totalBalance: result?.totalBalance || '0',
      totalLockBalance: result?.totalLockBalance || '0',
      tokens: tokens || []
    };
  }

  // 获取代币余额统计
  async getTokenBalanceStats(token_symbol: string): Promise<{
    totalUsers: number;
    totalBalance: string;
    totalLockBalance: string;
    addressTypes: Array<{
      address_type: number;
      count: number;
      total_balance: string;
    }>;
  }> {
    const result = await this.db.queryOne<{
      totalUsers: number;
      totalBalance: string;
      totalLockBalance: string;
    }>(`
      SELECT 
        COUNT(DISTINCT user_id) as totalUsers,
        SUM(CAST(balance AS INTEGER)) as totalBalance,
        SUM(CAST(lock_balance AS INTEGER)) as totalLockBalance
      FROM balances 
      WHERE token_symbol = ?
    `, [token_symbol]);

    const addressTypes = await this.db.query<{
      address_type: number;
      count: number;
      total_balance: string;
    }>(`
      SELECT 
        address_type,
        COUNT(*) as count,
        SUM(CAST(balance AS INTEGER)) as total_balance
      FROM balances 
      WHERE token_symbol = ?
      GROUP BY address_type
      ORDER BY address_type
    `, [token_symbol]);

    return {
      totalUsers: result?.totalUsers || 0,
      totalBalance: result?.totalBalance || '0',
      totalLockBalance: result?.totalLockBalance || '0',
      addressTypes: addressTypes || []
    };
  }

  // 更新用户代币余额
  async updateUserTokenBalance(user_id: number, token_symbol: string, address: string, balance: string, lock_balance?: string): Promise<Balance> {
    // 先查找现有记录
    const existing = await this.db.queryOne<Balance>(
      'SELECT * FROM balances WHERE user_id = ? AND token_symbol = ? AND address = ?',
      [user_id, token_symbol, address]
    );

    if (existing) {
      // 更新现有记录
      return await this.update(existing.id!, {
        balance,
        lock_balance: lock_balance || existing.lock_balance,
        timestamp: Date.now()
      });
    } else {
      // 创建新记录
      return await this.create({
        user_id,
        address,
        token_symbol,
        address_type: 0, // 默认用户地址
        balance,
        lock_balance: lock_balance || '0',
        timestamp: Date.now()
      });
    }
  }
}
