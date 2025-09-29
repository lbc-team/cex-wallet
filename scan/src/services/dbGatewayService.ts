// DB Gateway Service - 封装对 db_gateway API 的调用
export class DbGatewayService {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3003') {
    this.baseUrl = baseUrl;
  }

  /**
   * 更新credit状态（通过交易哈希）- 使用SQL语句
   */
  async updateCreditStatusByTxHash(txHash: string, status: string, blockNumber?: number): Promise<boolean> {
    try {
      let sql = `UPDATE credits SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE tx_hash = ?`;
      let values = [status, txHash];

      // 如果提供了block_number，也一起更新
      if (blockNumber !== undefined) {
        sql = `UPDATE credits SET status = ?, block_number = ?, updated_at = CURRENT_TIMESTAMP WHERE tx_hash = ?`;
        values = [status, blockNumber, txHash];
      }

      const response = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql,
          values: values
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '更新credit状态失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`更新credit状态失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return true;
    } catch (error) {
      console.error(`更新credit状态失败 (txHash: ${txHash}):`, error);
      return false;
    }
  }

  /**
   * 更新交易状态 - 使用SQL语句
   */
  async updateTransactionStatus(txHash: string, status: string): Promise<boolean> {
    try {
      const sql = `UPDATE transactions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE tx_hash = ?`;
      const values = [status, txHash];

      const response = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql,
          values: values
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '更新交易状态失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`更新交易状态失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return true;
    } catch (error) {
      console.error(`更新交易状态失败 (txHash: ${txHash}):`, error);
      return false;
    }
  }

  /**
   * 插入交易记录（通过构建SQL语句）
   */
  async insertTransactionWithSQL(params: {
    block_hash?: string;
    block_no?: number;
    tx_hash: string;
    from_addr?: string;
    to_addr?: string;
    token_addr?: string;
    amount?: string;
    type?: string;
    status?: string;
    confirmation_count?: number;
  }): Promise<boolean> {
    try {
      const sql = `INSERT INTO transactions
         (block_hash, block_no, tx_hash, from_addr, to_addr, token_addr, amount, type, status, confirmation_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;

      const values = [
        params.block_hash || null,
        params.block_no || null,
        params.tx_hash,
        params.from_addr || null,
        params.to_addr || null,
        params.token_addr || null,
        params.amount || null,
        params.type || null,
        params.status || null,
        params.confirmation_count || 0
      ];

      const response = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql,
          values: values
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '插入交易记录失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`插入交易记录失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return true;
    } catch (error) {
      console.error(`插入交易记录失败 (txHash: ${params.tx_hash}):`, error);
      return false;
    }
  }

  /**
   * 插入交易记录 - 使用SQL语句（替换原API调用）
   */
  async insertTransaction(params: {
    block_hash?: string;
    block_no?: number;
    tx_hash: string;
    from_addr?: string;
    to_addr?: string;
    token_addr?: string;
    amount?: string;
    type?: string;
    status?: string;
    confirmation_count?: number;
  }): Promise<boolean> {
    // 直接调用 SQL 版本的方法
    return await this.insertTransactionWithSQL(params);
  }

  /**
   * 插入区块记录 - 使用SQL语句
   */
  async insertBlock(params: {
    hash: string;
    parent_hash?: string;
    number: string;
    timestamp?: number;
    status?: string;
  }): Promise<boolean> {
    try {
      const sql = `INSERT OR REPLACE INTO blocks
        (hash, parent_hash, number, timestamp, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;

      const values = [
        params.hash,
        params.parent_hash || null,
        params.number,
        params.timestamp || null,
        params.status || 'confirmed'
      ];

      const response = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql,
          values: values
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '插入区块记录失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`插入区块记录失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return true;
    } catch (error) {
      console.error(`插入区块记录失败 (hash: ${params.hash}):`, error);
      return false;
    }
  }

  /**
   * 创建 credit 记录 - 使用SQL语句
   */
  async createCredit(params: {
    user_id: number;
    address?: string;
    token_id: number;
    token_symbol: string;
    amount: string;
    credit_type: string;
    business_type: string;
    reference_id: number | string;
    reference_type: string;
    chain_id?: number;
    chain_type?: string;
    status?: string;
    block_number?: number;
    tx_hash?: string;
    event_index?: number;
    metadata?: any;
  }): Promise<number | null> {
    try {
      const sql = `INSERT INTO credits (
        user_id, address, token_id, token_symbol, amount,
        credit_type, business_type, reference_id, reference_type,
        chain_id, chain_type, status, block_number, tx_hash, event_index, metadata,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;

      const values = [
        params.user_id,
        params.address || null,
        params.token_id,
        params.token_symbol,
        params.amount,
        params.credit_type,
        params.business_type,
        params.reference_id,
        params.reference_type,
        params.chain_id || null,
        params.chain_type || null,
        params.status || 'confirmed',
        params.block_number || null,
        params.tx_hash || null,
        params.event_index || null,
        params.metadata ? JSON.stringify(params.metadata) : null
      ];

      const response = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql,
          values: values
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '创建credit记录失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`创建credit记录失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return apiResult.data?.lastID || null;
    } catch (error) {
      console.error('创建credit记录失败:', error);
      return null;
    }
  }

  /**
   * 更新交易确认数 - 使用SQL语句
   */
  async updateTransactionConfirmationWithSQL(txHash: string, confirmationCount: number): Promise<boolean> {
    try {
      const sql = `UPDATE transactions SET confirmation_count = ?, updated_at = CURRENT_TIMESTAMP WHERE tx_hash = ?`;
      const values = [confirmationCount, txHash];

      const response = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql,
          values: values
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '更新交易确认数失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`更新交易确认数失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return true;
    } catch (error) {
      console.error(`更新交易确认数失败 (txHash: ${txHash}):`, error);
      return false;
    }
  }

  /**
   * 删除指定区块范围的Credit记录 - 使用SQL语句
   */
  async deleteCreditsByBlockRangeWithSQL(startBlock: number, endBlock: number): Promise<number> {
    try {
      const sql = `DELETE FROM credits WHERE block_number >= ? AND block_number <= ?`;
      const values = [startBlock, endBlock];

      const response = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql,
          values: values
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '删除Credit记录失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`删除Credit记录失败: ${apiResult.error?.message || '未知错误'}`);
      }

      // 返回受影响的行数
      return apiResult.data?.changes || 0;
    } catch (error) {
      console.error(`删除Credit记录失败 (startBlock: ${startBlock}, endBlock: ${endBlock}):`, error);
      return 0;
    }
  }

  /**
   * 创建充值Credit记录 - 使用SQL语句
   */
  async createDepositCreditWithSQL(params: {
    userId: number;
    address: string;
    tokenId: number;
    tokenSymbol: string;
    amount: string;
    txHash: string;
    blockNumber: number;
    chainId?: number;
    chainType?: string;
    eventIndex?: number;
    status?: 'pending' | 'confirmed' | 'finalized';
    metadata?: any;
  }): Promise<number | null> {
    try {
      const sql = `INSERT INTO credits (
        user_id, address, token_id, token_symbol, amount,
        credit_type, business_type, reference_id, reference_type,
        chain_id, chain_type, status, block_number, tx_hash, event_index, metadata,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;

      // 生成reference_id（与原有逻辑保持一致）
      const referenceId = `${params.txHash}_${params.eventIndex || 0}`;

      const values = [
        params.userId,
        params.address,
        params.tokenId,
        params.tokenSymbol,
        params.amount,
        'deposit', // credit_type
        'blockchain', // business_type
        referenceId, // reference_id
        'blockchain_tx', // reference_type
        params.chainId || null,
        params.chainType || null,
        params.status || 'confirmed',
        params.blockNumber,
        params.txHash,
        params.eventIndex || 0,
        params.metadata ? JSON.stringify(params.metadata) : null
      ];

      const response = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql,
          values: values
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '创建充值Credit记录失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        // 如果是唯一约束冲突（重复记录），返回null
        if (apiResult.error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          console.log('充值Credit记录已存在', { txHash: params.txHash, userId: params.userId });
          return null;
        }
        throw new Error(`创建充值Credit记录失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return apiResult.data?.lastID || null;
    } catch (error) {
      console.error(`创建充值Credit记录失败 (txHash: ${params.txHash}):`, error);
      return null;
    }
  }

  /**
   * 批量执行SQL操作（在事务中）
   */
  async executeBatchWithTransaction(operations: {
    sql: string;
    values: any[];
    description?: string;
  }[]): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/business/execute-batch-transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operations: operations
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '批量事务执行失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`批量事务执行失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return true;
    } catch (error) {
      console.error('批量事务执行失败:', error);
      return false;
    }
  }

  /**
   * 批量处理存款（在事务中）
   */
  async processDepositsInTransaction(deposits: Array<{
    // Transaction data
    transaction: {
      block_hash?: string;
      block_no?: number;
      tx_hash: string;
      from_addr?: string;
      to_addr?: string;
      token_addr?: string;
      amount?: string;
      type?: string;
      status?: string;
      confirmation_count?: number;
    };
    // Credit data
    credit: {
      user_id: number;
      address?: string;
      token_id: number;
      token_symbol: string;
      amount: string;
      credit_type: string;
      business_type: string;
      reference_id: number | string;
      reference_type: string;
      chain_id?: number;
      chain_type?: string;
      status?: string;
      block_number?: number;
      tx_hash?: string;
      event_index?: number;
      metadata?: any;
    };
  }>): Promise<boolean> {
    const operations = [];

    for (const deposit of deposits) {
      // 添加插入交易的操作
      operations.push({
        sql: `INSERT INTO transactions
         (block_hash, block_no, tx_hash, from_addr, to_addr, token_addr, amount, type, status, confirmation_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        values: [
          deposit.transaction.block_hash || null,
          deposit.transaction.block_no || null,
          deposit.transaction.tx_hash,
          deposit.transaction.from_addr || null,
          deposit.transaction.to_addr || null,
          deposit.transaction.token_addr || null,
          deposit.transaction.amount || null,
          deposit.transaction.type || null,
          deposit.transaction.status || null,
          deposit.transaction.confirmation_count || 0
        ],
        description: `插入交易记录: ${deposit.transaction.tx_hash}`
      });

      // 添加插入Credit的操作
      operations.push({
        sql: `INSERT INTO credits (
          user_id, address, token_id, token_symbol, amount,
          credit_type, business_type, reference_id, reference_type,
          chain_id, chain_type, status, block_number, tx_hash, event_index, metadata,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        values: [
          deposit.credit.user_id,
          deposit.credit.address || null,
          deposit.credit.token_id,
          deposit.credit.token_symbol,
          deposit.credit.amount,
          deposit.credit.credit_type,
          deposit.credit.business_type,
          deposit.credit.reference_id,
          deposit.credit.reference_type,
          deposit.credit.chain_id || null,
          deposit.credit.chain_type || null,
          deposit.credit.status || 'confirmed',
          deposit.credit.block_number || null,
          deposit.credit.tx_hash || null,
          deposit.credit.event_index || null,
          deposit.credit.metadata ? JSON.stringify(deposit.credit.metadata) : null
        ],
        description: `插入Credit记录: ${deposit.credit.tx_hash} for user ${deposit.credit.user_id}`
      });
    }

    return await this.executeBatchWithTransaction(operations);
  }

  /**
   * 批量插入区块（在事务中）
   */
  async insertBlocksInTransaction(blocks: Array<{
    hash: string;
    parent_hash?: string;
    number: string;
    timestamp?: number;
    status?: string;
  }>): Promise<boolean> {
    const operations = blocks.map(block => ({
      sql: `INSERT OR REPLACE INTO blocks
        (hash, parent_hash, number, timestamp, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      values: [
        block.hash,
        block.parent_hash || null,
        block.number,
        block.timestamp || null,
        block.status || 'confirmed'
      ],
      description: `插入区块: ${block.number} (${block.hash})`
    }));

    return await this.executeBatchWithTransaction(operations);
  }

  /**
   * 批量处理区块和存款（在事务中）
   */
  async processBlocksAndDepositsInTransaction(
    blocks: Array<{
      hash: string;
      parent_hash?: string;
      number: string;
      timestamp?: number;
      status?: string;
    }>,
    deposits: Array<{
      transaction: {
        block_hash?: string;
        block_no?: number;
        tx_hash: string;
        from_addr?: string;
        to_addr?: string;
        token_addr?: string;
        amount?: string;
        type?: string;
        status?: string;
        confirmation_count?: number;
      };
      credit: {
        user_id: number;
        address?: string;
        token_id: number;
        token_symbol: string;
        amount: string;
        credit_type: string;
        business_type: string;
        reference_id: number | string;
        reference_type: string;
        chain_id?: number;
        chain_type?: string;
        status?: string;
        block_number?: number;
        tx_hash?: string;
        event_index?: number;
        metadata?: any;
      };
    }>
  ): Promise<boolean> {
    const operations = [];

    // 添加区块操作
    for (const block of blocks) {
      operations.push({
        sql: `INSERT OR REPLACE INTO blocks
          (hash, parent_hash, number, timestamp, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        values: [
          block.hash,
          block.parent_hash || null,
          block.number,
          block.timestamp || null,
          block.status || 'confirmed'
        ],
        description: `插入区块: ${block.number} (${block.hash})`
      });
    }

    // 添加存款操作
    for (const deposit of deposits) {
      // 添加插入交易的操作
      operations.push({
        sql: `INSERT INTO transactions
         (block_hash, block_no, tx_hash, from_addr, to_addr, token_addr, amount, type, status, confirmation_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        values: [
          deposit.transaction.block_hash || null,
          deposit.transaction.block_no || null,
          deposit.transaction.tx_hash,
          deposit.transaction.from_addr || null,
          deposit.transaction.to_addr || null,
          deposit.transaction.token_addr || null,
          deposit.transaction.amount || null,
          deposit.transaction.type || null,
          deposit.transaction.status || null,
          deposit.transaction.confirmation_count || 0
        ],
        description: `插入交易记录: ${deposit.transaction.tx_hash}`
      });

      // 添加插入Credit的操作
      operations.push({
        sql: `INSERT INTO credits (
          user_id, address, token_id, token_symbol, amount,
          credit_type, business_type, reference_id, reference_type,
          chain_id, chain_type, status, block_number, tx_hash, event_index, metadata,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        values: [
          deposit.credit.user_id,
          deposit.credit.address || null,
          deposit.credit.token_id,
          deposit.credit.token_symbol,
          deposit.credit.amount,
          deposit.credit.credit_type,
          deposit.credit.business_type,
          deposit.credit.reference_id,
          deposit.credit.reference_type,
          deposit.credit.chain_id || null,
          deposit.credit.chain_type || null,
          deposit.credit.status || 'confirmed',
          deposit.credit.block_number || null,
          deposit.credit.tx_hash || null,
          deposit.credit.event_index || null,
          deposit.credit.metadata ? JSON.stringify(deposit.credit.metadata) : null
        ],
        description: `插入Credit记录: ${deposit.credit.tx_hash} for user ${deposit.credit.user_id}`
      });
    }

    return await this.executeBatchWithTransaction(operations);
  }

  /**
   * 获取待确认的交易 - 使用SQL语句
   */
  async getPendingTransactionsWithSQL(): Promise<any[]> {
    try {
      const sql = `SELECT * FROM transactions WHERE status IN (?, ?) ORDER BY block_no ASC`;
      const values = ['confirmed', 'safe']; // 获取 confirmed 和 safe 状态的交易

      const response = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql,
          values: values
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '获取待确认交易失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`获取待确认交易失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return apiResult.data || [];
    } catch (error) {
      console.error('获取待确认交易失败:', error);
      return [];
    }
  }

  /**
   * 获取区块的所有交易（用于区块回滚） - 使用SQL语句
   */
  async getTransactionsByBlockHash(blockHash: string): Promise<any[]> {
    try {
      const sql = `SELECT * FROM transactions WHERE block_hash = ? ORDER BY id ASC`;
      const values = [blockHash];

      const response = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql,
          values: values
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '获取交易记录失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`获取交易记录失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return apiResult.data || [];
    } catch (error) {
      console.error(`获取交易记录失败 (blockHash: ${blockHash}):`, error);
      return [];
    }
  }

  /**
   * 删除区块的所有交易（用于区块回滚） - 使用SQL语句
   */
  async deleteTransactionsByBlockHash(blockHash: string): Promise<{ deletedCount: number; transactionCount: number } | null> {
    try {
      // 先查询要删除的交易数量
      const countSql = `SELECT COUNT(*) as count FROM transactions WHERE block_hash = ?`;
      const deleteSql = `DELETE FROM transactions WHERE block_hash = ?`;
      const values = [blockHash];

      // 先获取交易数量
      const countResponse = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: countSql,
          values: values
        })
      });

      let transactionCount = 0;
      if (countResponse.ok) {
        const countResult = await countResponse.json() as any;
        if (countResult.success && countResult.data && countResult.data.length > 0) {
          transactionCount = countResult.data[0].count || 0;
        }
      }

      // 执行删除操作
      const deleteResponse = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: deleteSql,
          values: values
        })
      });

      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${deleteResponse.status} - ${errorData.error?.message || '删除交易记录失败'}`);
      }

      const deleteResult = await deleteResponse.json() as any;
      if (!deleteResult.success) {
        throw new Error(`删除交易记录失败: ${deleteResult.error?.message || '未知错误'}`);
      }

      return {
        deletedCount: deleteResult.data?.changes || 0,
        transactionCount: transactionCount
      };
    } catch (error) {
      console.error(`删除交易记录失败 (blockHash: ${blockHash}):`, error);
      return null;
    }
  }

  /**
   * 更新区块状态（用于区块回滚） - 使用SQL语句
   */
  async updateBlockStatus(blockHash: string, status: string): Promise<boolean> {
    try {
      const sql = `UPDATE blocks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE hash = ?`;
      const values = [status, blockHash];

      const response = await fetch(`${this.baseUrl}/api/business/execute-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: sql,
          values: values
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '更新区块状态失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`更新区块状态失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return true;
    } catch (error) {
      console.error(`更新区块状态失败 (blockHash: ${blockHash}):`, error);
      return false;
    }
  }
}

// 单例实例
let dbGatewayService: DbGatewayService | null = null;

/**
 * 获取 DbGatewayService 单例实例
 */
export function getDbGatewayService(): DbGatewayService {
  if (!dbGatewayService) {
    dbGatewayService = new DbGatewayService();
  }
  return dbGatewayService;
}