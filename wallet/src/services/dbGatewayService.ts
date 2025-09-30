import { v4 as uuidv4 } from 'uuid';
import { Ed25519Signer, SignaturePayload } from '../utils/crypto';

interface GatewayRequest {
  operation_id: string;
  operation_type: 'read' | 'write' | 'sensitive';
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete';
  data?: any;
  conditions?: any;
  business_signature: string;
  risk_control_signature?: string;
  timestamp: number;
  module: 'wallet' | 'scan';
}

interface GatewayResponse {
  success: boolean;
  operation_id: string;
  data?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

// DB Gateway Service - 封装对 db_gateway API 的调用
export class DbGatewayService {
  private baseUrl: string;
  private signer: Ed25519Signer;
  private module: 'wallet' | 'scan';

  constructor(baseUrl: string = 'http://localhost:3003', module: 'wallet' | 'scan' = 'wallet') {
    this.baseUrl = baseUrl;
    this.module = module;
    this.signer = new Ed25519Signer(); // 使用环境变量中的私钥
  }

  /**
   * 通用数据库操作执行方法
   */
  private async executeOperation(
    table: string,
    action: 'select' | 'insert' | 'update' | 'delete',
    operationType: 'read' | 'write' | 'sensitive',
    data?: any,
    conditions?: any
  ): Promise<any> {
    try {
      const operationId = uuidv4();
      const timestamp = Date.now();

      // 创建签名payload
      const signaturePayload: SignaturePayload = {
        operation_id: operationId,
        operation_type: operationType,
        table,
        action,
        data: data || null,
        conditions: conditions || null,
        timestamp,
        module: this.module
      };

      // 生成签名
      const signature = this.signer.sign(signaturePayload);

      // 构建请求
      const gatewayRequest: GatewayRequest = {
        operation_id: operationId,
        operation_type: operationType,
        table,
        action,
        data,
        conditions,
        business_signature: signature,
        timestamp,
        module: this.module
      };

      const response = await fetch(`${this.baseUrl}/api/database/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(gatewayRequest)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as GatewayResponse;
        throw new Error(`API调用失败: ${response.status} - ${errorData.error?.message || '操作失败'}`);
      }

      const apiResult = await response.json() as GatewayResponse;
      if (!apiResult.success) {
        throw new Error(`操作失败: ${apiResult.error?.message || '未知错误'}`);
      }

      return apiResult.data;
    } catch (error) {
      console.error('数据库操作失败:', error);
      throw error;
    }
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
      const data = {
        user_id: params.user_id,
        address: params.address,
        device: params.device || null,
        path: params.path || null,
        chain_type: params.chain_type,
        wallet_type: params.wallet_type || 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = await this.executeOperation('wallets', 'insert', 'write', data);

      return {
        id: result.lastID,
        user_id: params.user_id,
        address: params.address,
        chain_type: params.chain_type,
        wallet_type: params.wallet_type || 'user',
        path: params.path,
        created_at: data.created_at,
        updated_at: data.updated_at
      };
    } catch (error) {
      throw new Error(`创建钱包失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 查询钱包
   */
  async getWallets(conditions: {
    user_id?: number;
    address?: string;
    chain_type?: string;
  }): Promise<any[]> {
    try {
      const result = await this.executeOperation('wallets', 'select', 'read', undefined, conditions);
      return result || [];
    } catch (error) {
      throw new Error(`查询钱包失败: ${error instanceof Error ? error.message : '未知错误'}`);
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
      const data = {
        user_id: params.user_id,
        to_address: params.to_address,
        token_id: params.token_id,
        amount: params.amount,
        fee: params.fee,
        chain_id: params.chain_id,
        chain_type: params.chain_type,
        status: params.status || 'user_withdraw_request',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = await this.executeOperation('withdraws', 'insert', 'sensitive', data);
      return result.lastID;
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
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (data) {
        if (data.from_address !== undefined) updateData.from_address = data.from_address;
        if (data.tx_hash !== undefined) updateData.tx_hash = data.tx_hash;
        if (data.nonce !== undefined) updateData.nonce = data.nonce;
        if (data.gas_used !== undefined) updateData.gas_used = data.gas_used;
        if (data.gas_price !== undefined) updateData.gas_price = data.gas_price;
        if (data.max_fee_per_gas !== undefined) updateData.max_fee_per_gas = data.max_fee_per_gas;
        if (data.max_priority_fee_per_gas !== undefined) updateData.max_priority_fee_per_gas = data.max_priority_fee_per_gas;
        if (data.error_message !== undefined) updateData.error_message = data.error_message;
      }

      await this.executeOperation(
        'withdraws',
        'update',
        'sensitive',
        updateData,
        { id: withdrawId }
      );
    } catch (error) {
      throw new Error(`更新提现状态失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 查询提现记录
   */
  async getWithdraws(conditions: {
    id?: number;
    user_id?: number;
    status?: string;
    tx_hash?: string;
  }): Promise<any[]> {
    try {
      const result = await this.executeOperation('withdraws', 'select', 'read', undefined, conditions);
      return result || [];
    } catch (error) {
      throw new Error(`查询提现记录失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 原子性递增 nonce
   * 注意：这个操作比较特殊，需要先查询再条件更新
   */
  async atomicIncrementNonce(address: string, chainId: number, expectedNonce: number): Promise<{
    success: boolean;
    newNonce: number;
  }> {
    try {
      // 先查询当前nonce
      const currentRecords = await this.executeOperation(
        'wallet_nonces',
        'select',
        'read',
        undefined,
        { address, chain_id: chainId }
      );

      const currentNonce = currentRecords && currentRecords.length > 0 ? currentRecords[0].nonce : 0;

      // 检查期望的nonce是否匹配
      if (currentNonce !== expectedNonce) {
        return {
          success: false,
          newNonce: currentNonce
        };
      }

      // 执行更新（带条件检查）
      const updateData = {
        nonce: expectedNonce + 1,
        updated_at: new Date().toISOString()
      };

      const result = await this.executeOperation(
        'wallet_nonces',
        'update',
        'sensitive',
        updateData,
        { address, chain_id: chainId, nonce: expectedNonce }
      );

      // 检查是否更新成功
      if (result.changes > 0) {
        return {
          success: true,
          newNonce: expectedNonce + 1
        };
      } else {
        // 更新失败，重新查询当前nonce
        const retryRecords = await this.executeOperation(
          'wallet_nonces',
          'select',
          'read',
          undefined,
          { address, chain_id: chainId }
        );
        const retryNonce = retryRecords && retryRecords.length > 0 ? retryRecords[0].nonce : expectedNonce;
        return {
          success: false,
          newNonce: retryNonce
        };
      }
    } catch (error) {
      throw new Error(`原子性递增nonce失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 同步链上nonce到数据库
   */
  async syncNonceFromChain(address: string, chainId: number, chainNonce: number): Promise<boolean> {
    try {
      // 先查询记录是否存在
      const existingRecords = await this.executeOperation(
        'wallet_nonces',
        'select',
        'read',
        undefined,
        { address, chain_id: chainId }
      );

      if (existingRecords && existingRecords.length > 0) {
        // 记录存在，执行更新
        await this.executeOperation(
          'wallet_nonces',
          'update',
          'write',
          { nonce: chainNonce, updated_at: new Date().toISOString() },
          { address, chain_id: chainId }
        );
      } else {
        // 记录不存在，执行插入
        await this.executeOperation(
          'wallet_nonces',
          'insert',
          'write',
          {
            address,
            chain_id: chainId,
            nonce: chainNonce,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        );
      }

      return true;
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
      const data = {
        user_id: params.user_id,
        address: params.address || null,
        token_id: params.token_id,
        token_symbol: params.token_symbol,
        amount: params.amount,
        credit_type: params.credit_type,
        business_type: params.business_type,
        reference_id: params.reference_id,
        reference_type: params.reference_type,
        chain_id: params.chain_id || null,
        chain_type: params.chain_type || null,
        status: params.status || 'pending',
        block_number: params.block_number || null,
        tx_hash: params.tx_hash || null,
        event_index: params.event_index || null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = await this.executeOperation('credits', 'insert', 'write', data);
      return result.lastID;
    } catch (error) {
      throw new Error(`创建credit记录失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 查询 credit 记录
   */
  async getCredits(conditions: {
    user_id?: number;
    tx_hash?: string;
    status?: string;
    credit_type?: string;
  }): Promise<any[]> {
    try {
      const result = await this.executeOperation('credits', 'select', 'read', undefined, conditions);
      return result || [];
    } catch (error) {
      throw new Error(`查询credit记录失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 更新 credit 状态
   */
  async updateCreditStatus(creditId: number, status: string, data?: {
    tx_hash?: string;
    block_number?: number;
    error_message?: string;
  }): Promise<void> {
    try {
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (data) {
        if (data.tx_hash !== undefined) updateData.tx_hash = data.tx_hash;
        if (data.block_number !== undefined) updateData.block_number = data.block_number;
        if (data.error_message !== undefined) updateData.error_message = data.error_message;
      }

      await this.executeOperation(
        'credits',
        'update',
        'write',
        updateData,
        { id: creditId }
      );
    } catch (error) {
      throw new Error(`更新credit状态失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 根据交易哈希更新 credit 状态
   */
  async updateCreditStatusByTxHash(txHash: string, status: string, data?: {
    block_number?: number;
    error_message?: string;
  }): Promise<void> {
    try {
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (data) {
        if (data.block_number !== undefined) updateData.block_number = data.block_number;
        if (data.error_message !== undefined) updateData.error_message = data.error_message;
      }

      await this.executeOperation(
        'credits',
        'update',
        'write',
        updateData,
        { tx_hash: txHash }
      );
    } catch (error) {
      throw new Error(`根据交易哈希更新credit状态失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 删除指定区块范围的Credit记录（用于重组回滚）
   */
  async deleteByBlockRange(startBlock: number, endBlock: number): Promise<number> {
    try {
      const result = await this.executeOperation(
        'credits',
        'delete',
        'sensitive',
        undefined,
        {
          block_number: {
            '>=': startBlock,
            '<=': endBlock
          }
        }
      );
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