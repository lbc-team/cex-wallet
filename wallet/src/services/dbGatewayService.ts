// DB Gateway Service - 封装对 db_gateway API 的调用
export class DbGatewayService {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3003') {
    this.baseUrl = baseUrl;
  }

  /**
   * 创建钱包
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
      const response = await fetch(`${this.baseUrl}/api/business/wallets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: params.user_id,
          address: params.address,
          device: params.device,
          path: params.path,
          chain_type: params.chain_type,
          wallet_type: params.wallet_type || 'user'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '创建钱包失败'}`);
      }

      const apiResult = await response.json();
      if (!apiResult.success) {
        throw new Error(`创建钱包失败: ${apiResult.error?.message || '未知错误'}`);
      }

      // 构造返回的钱包对象，保持与原来的接口兼容
      return {
        id: apiResult.data.walletId,
        user_id: apiResult.data.user_id,
        address: apiResult.data.address,
        chain_type: apiResult.data.chain_type,
        wallet_type: apiResult.data.wallet_type,
        path: params.path,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`创建钱包失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 创建提现请求
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
      const response = await fetch(`${this.baseUrl}/api/business/withdraws`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: params.user_id,
          to_address: params.to_address,
          token_id: params.token_id,
          amount: params.amount,
          fee: params.fee,
          chain_id: params.chain_id,
          chain_type: params.chain_type,
          status: params.status || 'user_withdraw_request'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '创建提现请求失败'}`);
      }

      const apiResult = await response.json();
      if (!apiResult.success) {
        throw new Error(`创建提现请求失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return apiResult.data.withdrawId;
    } catch (error) {
      throw new Error(`创建提现请求失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 更新提现状态
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
      const requestBody: any = { status };

      if (data) {
        if (data.from_address) requestBody.from_address = data.from_address;
        if (data.tx_hash) requestBody.tx_hash = data.tx_hash;
        if (data.nonce !== undefined) requestBody.nonce = data.nonce;
        if (data.gas_used) requestBody.gas_used = data.gas_used;
        if (data.gas_price) requestBody.gas_price = data.gas_price;
        if (data.max_fee_per_gas) requestBody.max_fee_per_gas = data.max_fee_per_gas;
        if (data.max_priority_fee_per_gas) requestBody.max_priority_fee_per_gas = data.max_priority_fee_per_gas;
        if (data.error_message) requestBody.error_message = data.error_message;
      }

      const response = await fetch(`${this.baseUrl}/api/business/withdraws/${withdrawId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '更新提现状态失败'}`);
      }

      const apiResult = await response.json();
      if (!apiResult.success) {
        throw new Error(`更新提现状态失败: ${apiResult.error?.message || '未知错误'}`);
      }
    } catch (error) {
      throw new Error(`更新提现状态失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 原子性递增 nonce
   */
  async atomicIncrementNonce(address: string, chainId: number, expectedNonce: number): Promise<{
    success: boolean;
    newNonce: number;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/business/nonces/atomic-increment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: address,
          chain_id: chainId,
          expected_nonce: expectedNonce
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '原子性递增nonce失败'}`);
      }

      const apiResult = await response.json();
      if (!apiResult.success) {
        throw new Error(`原子性递增nonce失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return apiResult.data;
    } catch (error) {
      throw new Error(`原子性递增nonce失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 同步链上nonce到数据库
   */
  async syncNonceFromChain(address: string, chainId: number, chainNonce: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/business/nonces/sync-from-chain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: address,
          chain_id: chainId,
          chain_nonce: chainNonce
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '同步链上nonce失败'}`);
      }

      const apiResult = await response.json();
      if (!apiResult.success) {
        throw new Error(`同步链上nonce失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return apiResult.data.synced || true;
    } catch (error) {
      console.error('同步链上nonce失败:', error);
      return false;
    }
  }

  /**
   * 创建 credit 记录
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
      const response = await fetch(`${this.baseUrl}/api/business/credits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: params.user_id,
          address: params.address,
          token_id: params.token_id,
          token_symbol: params.token_symbol,
          amount: params.amount,
          credit_type: params.credit_type,
          business_type: params.business_type,
          reference_id: params.reference_id,
          reference_type: params.reference_type,
          chain_id: params.chain_id,
          chain_type: params.chain_type,
          status: params.status || 'pending',
          block_number: params.block_number,
          tx_hash: params.tx_hash,
          event_index: params.event_index,
          metadata: params.metadata
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '创建credit记录失败'}`);
      }

      const apiResult = await response.json();
      if (!apiResult.success) {
        throw new Error(`创建credit记录失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return apiResult.data.creditId;
    } catch (error) {
      throw new Error(`创建credit记录失败: ${error instanceof Error ? error.message : '未知错误'}`);
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