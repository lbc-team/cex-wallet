// DB Gateway Service - 封装对 db_gateway API 的调用
export class DbGatewayService {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3003') {
    this.baseUrl = baseUrl;
  }

  /**
   * 通用 SQL 执行方法
   */
  private async executeSQL(sql: string, values: any[] = []): Promise<any> {
    try {
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
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || 'SQL执行失败'}`);
      }

      const apiResult = await response.json() as any;
      if (!apiResult.success) {
        throw new Error(`SQL执行失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return apiResult.data;
    } catch (error) {
      console.error('SQL执行失败:', error);
      throw error;
    }
  }

  /**
   * 创建钱包 - 使用SQL语句
   */
  async createWallet(params: {
    user_id: number;
    address: string;
    device?: string;
    path?: string;
    chain_type: 'evm' | 'btc' | 'solana';
    wallet_type?: string;
  }): Promise<{
    id?: number;
    user_id: number;
    address: string;
    chain_type: string;
    wallet_type?: string;
    path?: string;
    created_at?: string;
    updated_at?: string;
  }> {
    try {
      const sql = `INSERT INTO wallets
        (user_id, address, device, path, chain_type, wallet_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;

      const values = [
        params.user_id,
        params.address,
        params.device || null,
        params.path || null,
        params.chain_type,
        params.wallet_type || 'user'
      ];

      const result = await this.executeSQL(sql, values);
      const walletId = result.lastID;

      return {
        id: walletId,
        user_id: params.user_id,
        address: params.address,
        chain_type: params.chain_type,
        wallet_type: params.wallet_type || 'user',
        path: params.path,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`创建钱包失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 创建提现请求 - 使用SQL语句
   */
  async createWithdrawRequest(params: {
    user_id: number;
    to_address: string;
    token_id: number;
    amount: string;
    fee: string;
    chain_id: number;
    chain_type: string;
    status?: string;
  }): Promise<number> {
    try {
      const sql = `INSERT INTO withdraws
        (user_id, to_address, token_id, amount, fee, chain_id, chain_type, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;

      const values = [
        params.user_id,
        params.to_address,
        params.token_id,
        params.amount,
        params.fee,
        params.chain_id,
        params.chain_type,
        params.status || 'user_withdraw_request'
      ];

      const result = await this.executeSQL(sql, values);
      return result.lastID;
    } catch (error) {
      throw new Error(`创建提现请求失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 更新提现状态 - 使用SQL语句
   */
  async updateWithdrawStatus(withdrawId: number, status: string, data?: {
    from_address?: string;
    tx_hash?: string;
    nonce?: number;
    gas_used?: string;
    gas_price?: string;
    max_fee_per_gas?: string;
    max_priority_fee_per_gas?: string;
    error_message?: string;
  }): Promise<void> {
    try {
      // 动态构建UPDATE语句
      const updateFields = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
      const values = [status];

      if (data) {
        if (data.from_address !== undefined) {
          updateFields.push('from_address = ?');
          values.push(data.from_address);
        }
        if (data.tx_hash !== undefined) {
          updateFields.push('tx_hash = ?');
          values.push(data.tx_hash);
        }
        if (data.nonce !== undefined) {
          updateFields.push('nonce = ?');
          values.push(data.nonce);
        }
        if (data.gas_used !== undefined) {
          updateFields.push('gas_used = ?');
          values.push(data.gas_used);
        }
        if (data.gas_price !== undefined) {
          updateFields.push('gas_price = ?');
          values.push(data.gas_price);
        }
        if (data.max_fee_per_gas !== undefined) {
          updateFields.push('max_fee_per_gas = ?');
          values.push(data.max_fee_per_gas);
        }
        if (data.max_priority_fee_per_gas !== undefined) {
          updateFields.push('max_priority_fee_per_gas = ?');
          values.push(data.max_priority_fee_per_gas);
        }
        if (data.error_message !== undefined) {
          updateFields.push('error_message = ?');
          values.push(data.error_message);
        }
      }

      const sql = `UPDATE withdraws SET ${updateFields.join(', ')} WHERE id = ?`;
      values.push(withdrawId);

      await this.executeSQL(sql, values);
    } catch (error) {
      throw new Error(`更新提现状态失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 原子性递增 nonce - 使用SQL语句
   */
  async atomicIncrementNonce(address: string, chainId: number, expectedNonce: number): Promise<{
    success: boolean;
    newNonce: number;
  }> {
    try {
      // 使用UPDATE语句进行原子性nonce递增，只有在当前nonce等于期望值时才更新
      const sql = `UPDATE nonce_manager
        SET nonce = nonce + 1, updated_at = CURRENT_TIMESTAMP
        WHERE address = ? AND chain_id = ? AND nonce = ?`;

      const values = [address, chainId, expectedNonce];
      const result = await this.executeSQL(sql, values);

      if (result.changes > 0) {
        // 更新成功，返回新的nonce
        return {
          success: true,
          newNonce: expectedNonce + 1
        };
      } else {
        // 更新失败，可能是nonce不匹配，查询当前nonce
        const selectSql = `SELECT nonce FROM nonce_manager WHERE address = ? AND chain_id = ?`;
        const selectResult = await this.executeSQL(selectSql, [address, chainId]);

        const currentNonce = selectResult.length > 0 ? selectResult[0].nonce : expectedNonce;
        return {
          success: false,
          newNonce: currentNonce
        };
      }
    } catch (error) {
      throw new Error(`原子性递增nonce失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 同步链上nonce到数据库 - 使用SQL语句
   */
  async syncNonceFromChain(address: string, chainId: number, chainNonce: number): Promise<boolean> {
    try {
      // 使用INSERT OR REPLACE来同步nonce，如果记录不存在则创建，存在则更新
      const sql = `INSERT OR REPLACE INTO nonce_manager
        (address, chain_id, nonce, updated_at, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP,
          COALESCE((SELECT created_at FROM nonce_manager WHERE address = ? AND chain_id = ?), CURRENT_TIMESTAMP))`;

      const values = [address, chainId, chainNonce, address, chainId];
      await this.executeSQL(sql, values);

      return true;
    } catch (error) {
      console.error('同步链上nonce失败:', error);
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
    reference_id: number;
    reference_type: string;
    chain_id?: number;
    chain_type?: string;
    status?: string;
    block_number?: number;
    tx_hash?: string;
    event_index?: number;
    metadata?: any;
  }): Promise<number> {
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
        params.status || 'pending',
        params.block_number || null,
        params.tx_hash || null,
        params.event_index || null,
        params.metadata ? JSON.stringify(params.metadata) : null
      ];

      const result = await this.executeSQL(sql, values);
      return result.lastID;
    } catch (error) {
      throw new Error(`创建credit记录失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 删除指定区块范围的Credit记录（用于重组回滚） - 使用SQL语句
   */
  async deleteByBlockRange(startBlock: number, endBlock: number): Promise<number> {
    try {
      const sql = `DELETE FROM credits WHERE block_number >= ? AND block_number <= ?`;
      const values = [startBlock, endBlock];

      const result = await this.executeSQL(sql, values);
      return result.changes || 0;
    } catch (error) {
      console.error(`删除Credit记录失败 (startBlock: ${startBlock}, endBlock: ${endBlock}):`, error);
      return 0;
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