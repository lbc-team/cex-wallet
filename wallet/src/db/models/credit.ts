import { DatabaseConnection } from '../connection';

// Credit类型枚举
export enum CreditType {
  // 链上相关
  DEPOSIT = 'deposit',           // 链上充值
  WITHDRAW = 'withdraw',         // 链上提现
  COLLECT = 'collect',          // 归集
  REBALANCE = 'rebalance',      // 调度
  
  // 交易相关
  TRADE_BUY = 'trade_buy',      // 买入
  TRADE_SELL = 'trade_sell',    // 卖出
  TRADE_FEE = 'trade_fee',      // 交易手续费
  
  // 其他业务
  TRANSFER_IN = 'transfer_in',   // 转入
  TRANSFER_OUT = 'transfer_out', // 转出
  FREEZE = 'freeze',            // 冻结
  UNFREEZE = 'unfreeze',        // 解冻
  REWARD = 'reward',            // 奖励
  PENALTY = 'penalty'           // 罚金
}

// 业务类型枚举
export enum BusinessType {
  BLOCKCHAIN = 'blockchain',     // 区块链交易
  SPOT_TRADE = 'spot_trade',    // 现货交易
  FUTURES_TRADE = 'futures_trade', // 期货交易
  INTERNAL_TRANSFER = 'internal_transfer', // 内部转账
  ADMIN_ADJUST = 'admin_adjust', // 管理员调整
  SYSTEM_REWARD = 'system_reward' // 系统奖励
}

// Credit接口定义
export interface Credit {
  id?: number;
  user_id: number;
  address: string;
  token_id: number;
  token_symbol: string;
  amount: string; // 正数入账，负数出账，以最小单位存储
  credit_type: CreditType;
  business_type: BusinessType;
  reference_id: string; // 关联业务ID
  reference_type: string; // 关联业务类型
  status: 'pending' | 'confirmed' | 'finalized' | 'failed';
  block_number?: number; // 链上交易才有
  tx_hash?: string; // 链上交易才有
  event_index: number; // 同一交易中的事件索引
  metadata?: string; // JSON格式的扩展信息
  created_at?: string;
  updated_at?: string;
}

// 创建Credit请求接口
export interface CreateCreditRequest {
  user_id: number;
  address: string;
  token_id: number;
  token_symbol: string;
  amount: string;
  credit_type: CreditType;
  business_type: BusinessType;
  reference_id: string;
  reference_type: string;
  status?: 'pending' | 'confirmed' | 'finalized' | 'failed';
  block_number?: number;
  tx_hash?: string;
  event_index?: number;
  metadata?: string;
}

// 余额查询结果接口
export interface UserBalance {
  user_id: number;
  address: string;
  token_id: number;
  token_symbol: string;
  decimals: number;
  available_balance: string; // 可用余额（最小单位）
  frozen_balance: string; // 冻结余额（最小单位）
  total_balance: string; // 总余额（最小单位）
  available_balance_formatted: string; // 格式化的可用余额
  frozen_balance_formatted: string; // 格式化的冻结余额
  total_balance_formatted: string; // 格式化的总余额
}

// Credit查询选项
export interface CreditQueryOptions {
  user_id?: number;
  token_id?: number;
  credit_type?: CreditType;
  business_type?: BusinessType;
  status?: string;
  reference_id?: string;
  reference_type?: string;
  tx_hash?: string;
  limit?: number;
  offset?: number;
  order_by?: 'created_at' | 'amount' | 'id';
  order_direction?: 'ASC' | 'DESC';
}

// Credit数据模型类
export class CreditModel {
  private db: DatabaseConnection;

  constructor(database: DatabaseConnection) {
    this.db = database;
  }

  // 创建 Credit记录（幂等性保证）
  async create(creditData: CreateCreditRequest): Promise<Credit> {
    const {
      user_id, address, token_id, token_symbol, amount,
      credit_type, business_type, reference_id, reference_type,
      status = 'pending', block_number, tx_hash,
      event_index = 0, metadata
    } = creditData;

    try {
      const result = await this.db.run(
        `INSERT INTO credits (
          user_id, address, token_id, token_symbol, amount,
          credit_type, business_type, reference_id, reference_type,
          status, block_number, tx_hash, event_index, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user_id, address, token_id, token_symbol, amount,
          credit_type, business_type, reference_id, reference_type,
          status, block_number, tx_hash, event_index, metadata
        ]
      );

      const newCredit = await this.findById(result.lastID);
      if (!newCredit) {
        throw new Error('创建Credit后无法获取记录信息');
      }

      return newCredit;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        // 重复处理，查询现有记录返回
        const existing = await this.findByReference(reference_id, reference_type, event_index);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  // 根据ID查找Credit
  async findById(id: number): Promise<Credit | null> {
    const credit = await this.db.queryOne<Credit>(
      'SELECT * FROM credits WHERE id = ?',
      [id]
    );
    return credit || null;
  }

  // 根据业务引用查找Credit
  async findByReference(referenceId: string, referenceType: string, eventIndex: number = 0): Promise<Credit | null> {
    const credit = await this.db.queryOne<Credit>(
      'SELECT * FROM credits WHERE reference_id = ? AND reference_type = ? AND event_index = ?',
      [referenceId, referenceType, eventIndex]
    );
    return credit || null;
  }

  // 查询用户的Credit记录
  async findByUser(userId: number, options?: CreditQueryOptions): Promise<Credit[]> {
    let sql = 'SELECT * FROM credits WHERE user_id = ?';
    const params: any[] = [userId];

    // 添加过滤条件
    if (options?.token_id) {
      sql += ' AND token_id = ?';
      params.push(options.token_id);
    }

    if (options?.credit_type) {
      sql += ' AND credit_type = ?';
      params.push(options.credit_type);
    }

    if (options?.business_type) {
      sql += ' AND business_type = ?';
      params.push(options.business_type);
    }

    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }

    if (options?.reference_type) {
      sql += ' AND reference_type = ?';
      params.push(options.reference_type);
    }

    if (options?.tx_hash) {
      sql += ' AND tx_hash = ?';
      params.push(options.tx_hash);
    }

    // 添加排序
    const orderBy = options?.order_by || 'created_at';
    const orderDirection = options?.order_direction || 'DESC';
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

    return await this.db.query<Credit>(sql, params);
  }

  // 更新Credit状态
  async updateStatus(id: number, status: 'pending' | 'confirmed' | 'finalized' | 'failed'): Promise<Credit> {
    const result = await this.db.run(
      'UPDATE credits SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, id]
    );

    if (result.changes === 0) {
      throw new Error('Credit不存在或更新失败');
    }

    const updatedCredit = await this.findById(id);
    if (!updatedCredit) {
      throw new Error('更新后无法获取Credit信息');
    }

    return updatedCredit;
  }

  // 批量更新Credit状态（通过tx_hash）
  async updateStatusByTxHash(txHash: string, status: 'pending' | 'confirmed' | 'finalized' | 'failed'): Promise<void> {
    await this.db.run(
      'UPDATE credits SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE tx_hash = ?',
      [status, txHash]
    );
  }

  // 获取用户余额（实时计算）
  async getUserBalances(userId: number, tokenId?: number): Promise<UserBalance[]> {
    let sql = `
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
          THEN CAST(c.amount AS REAL) 
          ELSE 0 
        END) as frozen_balance,
        SUM(CASE 
          WHEN c.status = 'finalized' 
          THEN CAST(c.amount AS REAL) 
          ELSE 0 
        END) as total_balance
      FROM credits c
      JOIN tokens t ON c.token_id = t.id
      WHERE c.user_id = ?
    `;

    const params: any[] = [userId];

    if (tokenId) {
      sql += ' AND c.token_id = ?';
      params.push(tokenId);
    }

    sql += `
      GROUP BY c.user_id, c.address, c.token_id, c.token_symbol, t.decimals
      HAVING total_balance != 0
      ORDER BY c.token_symbol
    `;

    const rows = await this.db.query<{
      user_id: number;
      address: string;
      token_id: number;
      token_symbol: string;
      decimals: number;
      available_balance: number;
      frozen_balance: number;
      total_balance: number;
    }>(sql, params);

    return rows.map(row => {
      const divisor = Math.pow(10, row.decimals);
      return {
        user_id: row.user_id,
        address: row.address,
        token_id: row.token_id,
        token_symbol: row.token_symbol,
        decimals: row.decimals,
        available_balance: row.available_balance.toString(),
        frozen_balance: row.frozen_balance.toString(),
        total_balance: row.total_balance.toString(),
        available_balance_formatted: (row.available_balance / divisor).toFixed(6),
        frozen_balance_formatted: (row.frozen_balance / divisor).toFixed(6),
        total_balance_formatted: (row.total_balance / divisor).toFixed(6)
      };
    });
  }

  // 获取指定地址的余额（用于热钱包余额查询）
  async getUserBalancesByAddress(address: string, tokenId?: number): Promise<UserBalance[]> {
    let sql = `
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
          THEN CAST(c.amount AS REAL) 
          ELSE 0 
        END) as frozen_balance,
        SUM(CASE 
          WHEN c.status = 'finalized' 
          THEN CAST(c.amount AS REAL) 
          ELSE 0 
        END) as total_balance
      FROM credits c
      JOIN tokens t ON c.token_id = t.id
      WHERE c.address = ?
    `;

    const params: any[] = [address];

    if (tokenId) {
      sql += ' AND c.token_id = ?';
      params.push(tokenId);
    }

    sql += `
      GROUP BY c.user_id, c.address, c.token_id, c.token_symbol, t.decimals
      HAVING total_balance != 0
      ORDER BY c.token_symbol
    `;

    const rows = await this.db.query<{
      user_id: number;
      address: string;
      token_id: number;
      token_symbol: string;
      decimals: number;
      available_balance: number;
      frozen_balance: number;
      total_balance: number;
    }>(sql, params);

    return rows.map(row => {
      const divisor = Math.pow(10, row.decimals);
      return {
        user_id: row.user_id,
        address: row.address,
        token_id: row.token_id,
        token_symbol: row.token_symbol,
        decimals: row.decimals,
        available_balance: row.available_balance.toString(),
        frozen_balance: row.frozen_balance.toString(),
        total_balance: row.total_balance.toString(),
        available_balance_formatted: (row.available_balance / divisor).toFixed(6),
        frozen_balance_formatted: (row.frozen_balance / divisor).toFixed(6),
        total_balance_formatted: (row.total_balance / divisor).toFixed(6)
      };
    });
  }

  // 获取用户各代币总余额（跨地址聚合）
  async getUserTotalBalancesByToken(userId: number): Promise<{
    token_symbol: string;
    total_balance: string;
    available_balance: string;
    frozen_balance: string;
    address_count: number;
  }[]> {
    // 使用视图优化性能
    const sql = `
      SELECT 
        token_symbol,
        total_available_formatted as available_balance,
        total_frozen_formatted as frozen_balance,
        total_balance_formatted as total_balance,
        address_count
      FROM v_user_token_totals 
      WHERE user_id = ?
      ORDER BY total_balance DESC
    `;

    const rows = await this.db.query<{
      token_symbol: string;
      available_balance: string;
      frozen_balance: string;
      total_balance: string;
      address_count: number;
    }>(sql, [userId]);

    return rows;
  }

  // 删除Credit记录（用于重组回滚）
  async deleteByBlockRange(startBlock: number, endBlock: number): Promise<number> {
    const result = await this.db.run(
      'DELETE FROM credits WHERE block_number >= ? AND block_number <= ?',
      [startBlock, endBlock]
    );
    return result.changes || 0;
  }

  // 获取Credit统计信息
  async getStats(userId?: number): Promise<{
    totalCredits: number;
    pendingCredits: number;
    confirmedCredits: number;
    finalizedCredits: number;
    failedCredits: number;
  }> {
    let sql = `
      SELECT 
        COUNT(*) as totalCredits,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingCredits,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmedCredits,
        SUM(CASE WHEN status = 'finalized' THEN 1 ELSE 0 END) as finalizedCredits,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCredits
      FROM credits
    `;

    const params: any[] = [];

    if (userId) {
      sql += ' WHERE user_id = ?';
      params.push(userId);
    }

    const result = await this.db.queryOne<{
      totalCredits: number;
      pendingCredits: number;
      confirmedCredits: number;
      finalizedCredits: number;
      failedCredits: number;
    }>(sql, params);

    return result || {
      totalCredits: 0,
      pendingCredits: 0,
      confirmedCredits: 0,
      finalizedCredits: 0,
      failedCredits: 0
    };
  }
}
