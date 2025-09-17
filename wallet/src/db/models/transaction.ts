import { DatabaseConnection } from '../connection';

// 交易接口定义
export interface Transaction {
  id?: number;
  block_hash?: string;
  block_no?: number;
  tx_hash: string;
  from_addr: string;
  to_addr: string;
  token_addr?: string;
  amount: number;
  fee?: number;
  type: 'deposit' | 'withdraw' | 'collect' | 'rebalance';
  status: 'pending' | 'confirmed' | 'failed';
  created_at?: string;
}

// 创建交易请求接口
export interface CreateTransactionRequest {
  block_hash?: string;
  block_no?: number;
  tx_hash: string;
  from_addr: string;
  to_addr: string;
  token_addr?: string;
  amount: number;
  fee?: number;
  type: 'deposit' | 'withdraw' | 'collect' | 'rebalance';
  status?: 'pending' | 'confirmed' | 'failed';
}

// 交易更新接口
export interface UpdateTransactionRequest {
  status?: 'pending' | 'confirmed' | 'failed';
  amount?: number;
}

// 交易查询选项
export interface TransactionQueryOptions {
  from_addr?: string;
  to_addr?: string;
  token_addr?: string;
  type?: 'deposit' | 'withdraw' | 'collect' | 'rebalance';
  status?: 'pending' | 'confirmed' | 'failed';
  limit?: number | undefined;
  offset?: number | undefined;
  orderBy?: 'created_at' | 'amount' | 'type' | 'block_no';
  orderDirection?: 'ASC' | 'DESC';
}

// 交易数据模型类
export class TransactionModel {
  private db: DatabaseConnection;

  constructor(database: DatabaseConnection) {
    this.db = database;
  }

  // 创建新交易
  async create(transactionData: CreateTransactionRequest): Promise<Transaction> {
    const { block_hash, block_no, tx_hash, from_addr, to_addr, token_addr, amount, fee, type, status = 'pending' } = transactionData;
    
    const result = await this.db.run(
      'INSERT INTO transactions (block_hash, block_no, tx_hash, from_addr, to_addr, token_addr, amount, fee, type, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [block_hash, block_no, tx_hash, from_addr, to_addr, token_addr, amount, fee, type, status]
    );

    const newTransaction = await this.findById(result.lastID);
    if (!newTransaction) {
      throw new Error('创建交易后无法获取交易信息');
    }

    return newTransaction;
  }

  // 根据ID查找交易
  async findById(id: number): Promise<Transaction | null> {
    const transaction = await this.db.queryOne<Transaction>(
      'SELECT * FROM transactions WHERE id = ?',
      [id]
    );
    return transaction || null;
  }

  // 根据交易哈希查找交易
  async findByHash(tx_hash: string): Promise<Transaction | null> {
    const transaction = await this.db.queryOne<Transaction>(
      'SELECT * FROM transactions WHERE tx_hash = ?',
      [tx_hash]
    );
    return transaction || null;
  }

  // 根据地址获取交易记录
  async findByAddress(address: string, options?: TransactionQueryOptions): Promise<Transaction[]> {
    let sql = 'SELECT * FROM transactions WHERE from_addr = ? OR to_addr = ?';
    const params: any[] = [address, address];

    // 添加过滤条件
    if (options?.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
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

    return await this.db.query<Transaction>(sql, params);
  }

  // 获取用户充值中的余额（confirmed 和 safe 状态的 deposit 交易，处理decimals并格式化）
  async getUserPendingDepositBalances(user_id: number): Promise<{
    token_symbol: string;
    pending_amount: string;
    transaction_count: number;
  }[]> {
    const sql = `
      SELECT 
        CASE 
          WHEN t.token_addr IS NULL THEN 'ETH'
          ELSE COALESCE(tk.token_symbol, 'UNKNOWN')
        END as token_symbol,
        SUM(t.amount) as raw_amount,
        COALESCE(tk.decimals, 18) as decimals,
        COUNT(*) as transaction_count
      FROM transactions t
      LEFT JOIN wallets w ON t.to_addr = w.address
      LEFT JOIN tokens tk ON t.token_addr = tk.token_address
      WHERE w.user_id = ? 
        AND t.type = 'deposit' 
        AND t.status IN ('confirmed', 'safe')
      GROUP BY token_symbol, tk.decimals
      HAVING raw_amount > 0
      ORDER BY raw_amount DESC
    `;
    
    const rows = await this.db.query<{
      token_symbol: string;
      raw_amount: number;
      decimals: number;
      transaction_count: number;
    }>(sql, [user_id]);

    return rows.map(row => ({
      token_symbol: row.token_symbol,
      pending_amount: (row.raw_amount / Math.pow(10, row.decimals)).toFixed(6),
      transaction_count: row.transaction_count
    }));
  }

  // 获取所有交易
  async findAll(options?: TransactionQueryOptions): Promise<Transaction[]> {
    let sql = 'SELECT * FROM transactions WHERE 1=1';
    const params: any[] = [];

    // 添加过滤条件
    if (options?.from_addr) {
      sql += ' AND from_addr = ?';
      params.push(options.from_addr);
    }

    if (options?.to_addr) {
      sql += ' AND to_addr = ?';
      params.push(options.to_addr);
    }

    if (options?.token_addr) {
      sql += ' AND token_addr = ?';
      params.push(options.token_addr);
    }

    if (options?.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
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

    return await this.db.query<Transaction>(sql, params);
  }

  // 更新交易状态
  async updateStatus(id: number, status: 'pending' | 'confirmed' | 'failed'): Promise<Transaction> {
    const result = await this.db.run(
      'UPDATE transactions SET status = ? WHERE id = ?',
      [status, id]
    );

    if (result.changes === 0) {
      throw new Error('交易不存在或更新失败');
    }

    const updatedTransaction = await this.findById(id);
    if (!updatedTransaction) {
      throw new Error('更新后无法获取交易信息');
    }

    return updatedTransaction;
  }

  // 更新交易信息
  async update(id: number, updateData: UpdateTransactionRequest): Promise<Transaction> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updateData.status !== undefined) {
      fields.push('status = ?');
      values.push(updateData.status);
    }

    if (updateData.amount !== undefined) {
      fields.push('amount = ?');
      values.push(updateData.amount);
    }

    if (fields.length === 0) {
      throw new Error('没有要更新的字段');
    }

    values.push(id);

    const sql = `UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`;
    const result = await this.db.run(sql, values);

    if (result.changes === 0) {
      throw new Error('交易不存在或更新失败');
    }

    const updatedTransaction = await this.findById(id);
    if (!updatedTransaction) {
      throw new Error('更新后无法获取交易信息');
    }

    return updatedTransaction;
  }

  // 删除交易
  async delete(id: number): Promise<void> {
    const result = await this.db.run('DELETE FROM transactions WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      throw new Error('交易不存在或删除失败');
    }
  }

  // 检查交易是否存在
  async exists(id: number): Promise<boolean> {
    const result = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM transactions WHERE id = ?',
      [id]
    );
    
    return (result?.count || 0) > 0;
  }

  // 检查交易哈希是否已存在
  async hashExists(tx_hash: string): Promise<boolean> {
    const result = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM transactions WHERE tx_hash = ?',
      [tx_hash]
    );
    
    return (result?.count || 0) > 0;
  }

  // 获取交易统计信息
  async getStats(wallet_id?: number): Promise<{
    totalTransactions: number;
    totalAmount: number;
    pendingCount: number;
    confirmedCount: number;
    failedCount: number;
  }> {
    let sql = `
      SELECT 
        COUNT(*) as totalTransactions,
        COALESCE(SUM(amount), 0) as totalAmount,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingCount,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmedCount,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCount
      FROM transactions
    `;
    
    const params: any[] = [];
    
    if (wallet_id) {
      sql += ' WHERE wallet_id = ?';
      params.push(wallet_id);
    }

    const result = await this.db.queryOne<{
      totalTransactions: number;
      totalAmount: number;
      pendingCount: number;
      confirmedCount: number;
      failedCount: number;
    }>(sql, params);

    return result || {
      totalTransactions: 0,
      totalAmount: 0,
      pendingCount: 0,
      confirmedCount: 0,
      failedCount: 0
    };
  }

  // 获取钱包的余额变化历史
  async getBalanceHistory(wallet_id: number, limit: number = 100): Promise<{
    date: string;
    total_deposits: number;
    total_withdrawals: number;
    net_change: number;
  }[]> {
    const sql = `
      SELECT 
        DATE(created_at) as date,
        SUM(CASE WHEN type = 'deposit' AND status = 'confirmed' THEN amount ELSE 0 END) as total_deposits,
        SUM(CASE WHEN type IN ('withdraw', 'transfer') AND status = 'confirmed' THEN amount ELSE 0 END) as total_withdrawals,
        SUM(CASE 
          WHEN type = 'deposit' AND status = 'confirmed' THEN amount 
          WHEN type IN ('withdraw', 'transfer') AND status = 'confirmed' THEN -amount 
          ELSE 0 
        END) as net_change
      FROM transactions 
      WHERE wallet_id = ?
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT ?
    `;

    return await this.db.query<{
      date: string;
      total_deposits: number;
      total_withdrawals: number;
      net_change: number;
    }>(sql, [wallet_id, limit]);
  }
}
