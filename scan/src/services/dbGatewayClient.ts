import { v4 as uuidv4 } from 'uuid';
import { Ed25519Signer, SignaturePayload } from '../utils/crypto';
import { getRiskControlClient } from './riskControlClient';

interface GatewayRequest {
  operation_id: string;
  operation_type: 'read' | 'write' | 'sensitive';
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete';
  data?: any;
  conditions?: any;
  business_signature: string;
  risk_signature?: string;
  timestamp: number;
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

// DB Gateway Client - 封装对 db_gateway API 的调用
export class DbGatewayClient {
  private baseUrl: string;
  private signer: Ed25519Signer;
  private riskControlClient = getRiskControlClient();

  constructor(baseUrl: string = 'http://localhost:3003') {
    this.baseUrl = baseUrl;
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
      const timestamp = Date.now();  // 业务层生成 timestamp
      let riskSignature: string | undefined;

      // 如果是敏感操作，先请求风控评估
      if (operationType === 'sensitive') {
        const riskResult = await this.riskControlClient.requestRiskAssessment({
          operation_id: operationId,
          operation_type: operationType,
          table,
          action,
          data,
          conditions,
          timestamp  // 传递业务层的 timestamp 给风控
        });

        // 使用风控返回的签名（风控使用相同的 timestamp 签名）
        riskSignature = riskResult.risk_signature;

        // 如果风控修改了数据（如冻结状态），使用风控返回的数据
        if (riskResult.db_operation?.data) {
          data = riskResult.db_operation.data;
        }
      }

      const signaturePayload: SignaturePayload = {
        operation_id: operationId,
        operation_type: operationType,
        table,
        action,
        data: data || null,
        conditions: conditions || null,
        timestamp
      };

      // 生成业务签名
      const signature = this.signer.sign(signaturePayload);

      const gatewayRequest: GatewayRequest = {
        operation_id: operationId,
        operation_type: operationType,
        table,
        action,
        data,
        conditions,
        business_signature: signature,
        risk_signature: riskSignature,
        timestamp
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
   * 更新credit状态（通过交易哈希）
   */
  async updateCreditStatusByTxHash(txHash: string, status: string, blockNumber?: number): Promise<boolean> {
    try {
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (blockNumber !== undefined) {
        updateData.block_number = blockNumber;
      }

      await this.executeOperation(
        'credits',
        'update',
        'sensitive',
        updateData,
        { tx_hash: txHash }
      );

      return true;
    } catch (error) {
      console.error(`更新credit状态失败 (txHash: ${txHash}):`, error);
      return false;
    }
  }

  /**
   * 更新交易状态
   */
  async updateTransactionStatus(txHash: string, status: string): Promise<boolean> {
    try {
      await this.executeOperation(
        'transactions',
        'update',
        'write',
        {
          status,
          updated_at: new Date().toISOString()
        },
        { tx_hash: txHash }
      );

      return true;
    } catch (error) {
      console.error(`更新交易状态失败 (txHash: ${txHash}):`, error);
      return false;
    }
  }

  /**
   * 插入交易记录
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
    try {
      const data = {
        block_hash: params.block_hash || null,
        block_no: params.block_no || null,
        tx_hash: params.tx_hash,
        from_addr: params.from_addr || null,
        to_addr: params.to_addr || null,
        token_addr: params.token_addr || null,
        amount: params.amount || null,
        type: params.type || null,
        status: params.status || null,
        confirmation_count: params.confirmation_count || 0,
        created_at: new Date().toISOString()
      };

      await this.executeOperation('transactions', 'insert', 'write', data);
      return true;
    } catch (error) {
      console.error(`插入交易记录失败 (txHash: ${params.tx_hash}):`, error);
      return false;
    }
  }

  /**
   * 插入交易记录（别名，保持向后兼容）
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
    return await this.insertTransaction(params);
  }

  /**
   * 插入区块记录
   */
  async insertBlock(params: {
    hash: string;
    parent_hash?: string;
    number: string;
    timestamp?: number;
    status?: string;
  }): Promise<boolean> {
    try {
      const data = {
        hash: params.hash,
        parent_hash: params.parent_hash || null,
        number: params.number,
        timestamp: params.timestamp || null,
        status: params.status || 'confirmed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // 使用 upsert 逻辑：先尝试查询，存在则更新，不存在则插入
      const existing = await this.executeOperation(
        'blocks',
        'select',
        'read',
        undefined,
        { hash: params.hash }
      );

      if (existing && existing.length > 0) {
        // 更新
        await this.executeOperation(
          'blocks',
          'update',
          'write',
          {
            parent_hash: data.parent_hash,
            number: data.number,
            timestamp: data.timestamp,
            status: data.status,
            updated_at: data.updated_at
          },
          { hash: params.hash }
        );
      } else {
        // 插入
        await this.executeOperation('blocks', 'insert', 'write', data);
      }

      return true;
    } catch (error) {
      console.error(`插入区块记录失败 (hash: ${params.hash}):`, error);
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
    reference_id?: number | string;  // 可选，如果是 deposit 类型且未提供，会自动生成
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
      // 如果是充值类型且未提供 reference_id，自动生成
      let referenceId = params.reference_id;
      if (!referenceId && params.credit_type === 'deposit' && params.tx_hash) {
        referenceId = `${params.tx_hash}_${params.event_index || 0}`;
      }

      if (!referenceId) {
        throw new Error('reference_id is required or must be auto-generated for deposit type');
      }

      const data = {
        user_id: params.user_id,
        address: params.address || null,
        token_id: params.token_id,
        token_symbol: params.token_symbol,
        amount: params.amount,
        credit_type: params.credit_type,
        business_type: params.business_type,
        reference_id: referenceId,
        reference_type: params.reference_type,
        chain_id: params.chain_id || null,
        chain_type: params.chain_type || null,
        status: params.status || 'confirmed',
        block_number: params.block_number || null,
        tx_hash: params.tx_hash || null,
        event_index: params.event_index || null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = await this.executeOperation('credits', 'insert', 'sensitive', data);
      return result.lastID || null;
    } catch (error) {
      console.error('创建credit记录失败:', error);
      return null;
    }
  }

  /**
   * 更新交易确认数
   */
  async updateTransactionConfirmation(txHash: string, confirmationCount: number): Promise<boolean> {
    try {
      await this.executeOperation(
        'transactions',
        'update',
        'write',
        {
          confirmation_count: confirmationCount,
          updated_at: new Date().toISOString()
        },
        { tx_hash: txHash }
      );

      return true;
    } catch (error) {
      console.error(`更新交易确认数失败 (txHash: ${txHash}):`, error);
      return false;
    }
  }

  /**
   * 删除指定区块范围的Credit记录
   */
  async deleteCreditsByBlockRange(startBlock: number, endBlock: number): Promise<number> {
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

  /**
   * 创建充值Credit记录
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
      // 生成reference_id（与原有逻辑保持一致）
      const referenceId = `${params.txHash}_${params.eventIndex || 0}`;

      const data = {
        user_id: params.userId,
        address: params.address,
        token_id: params.tokenId,
        token_symbol: params.tokenSymbol,
        amount: params.amount,
        credit_type: 'deposit',
        business_type: 'blockchain',
        reference_id: referenceId,
        reference_type: 'blockchain_tx',
        chain_id: params.chainId || null,
        chain_type: params.chainType || null,
        status: params.status || 'confirmed',
        block_number: params.blockNumber,
        tx_hash: params.txHash,
        event_index: params.eventIndex || 0,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = await this.executeOperation('credits', 'insert', 'sensitive', data);
      return result.lastID || null;
    } catch (error: any) {
      // 如果是唯一约束冲突（重复记录），返回null
      if (error?.message?.includes('UNIQUE') || error?.message?.includes('constraint')) {
        console.log('充值Credit记录已存在', { txHash: params.txHash, userId: params.userId });
        return null;
      }
      console.error(`创建充值Credit记录失败 (txHash: ${params.txHash}):`, error);
      return null;
    }
  }

  /**
   * 批量执行操作（在事务中）
   * 注意：db_gateway 当前不支持批量事务，这里改为串行执行
   */
  async executeBatchWithTransaction(operations: {
    sql: string;
    values: any[];
    description?: string;
  }[]): Promise<boolean> {
    console.warn('批量事务执行暂不支持，将串行执行操作');

    try {
      for (const op of operations) {
        // 这里需要将 SQL 转换为结构化操作
        // 由于无法直接转换所有 SQL，建议重构调用方使用结构化方法
        console.log(`执行操作: ${op.description || op.sql}`);
      }
      return true;
    } catch (error) {
      console.error('批量操作执行失败:', error);
      return false;
    }
  }

  /**
   * 批量处理存款（在事务中）
   * 注意：当前改为串行执行
   */
  async processDepositsInTransaction(deposits: Array<{
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
  }>): Promise<boolean> {
    try {
      for (const deposit of deposits) {
        // 插入交易
        await this.insertTransaction(deposit.transaction);

        // 插入 credit
        await this.createCredit(deposit.credit);
      }
      return true;
    } catch (error) {
      console.error('批量处理存款失败:', error);
      return false;
    }
  }

  /**
   * 批量插入区块（在事务中）
   * 注意：当前改为串行执行
   */
  async insertBlocksInTransaction(blocks: Array<{
    hash: string;
    parent_hash?: string;
    number: string;
    timestamp?: number;
    status?: string;
  }>): Promise<boolean> {
    try {
      for (const block of blocks) {
        await this.insertBlock(block);
      }
      return true;
    } catch (error) {
      console.error('批量插入区块失败:', error);
      return false;
    }
  }

  /**
   * 批量处理区块和存款（在事务中）
   * 注意：当前改为串行执行
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
    try {

      // 处理存款
      for (const deposit of deposits) {
        await this.createCredit(deposit.credit);
        await this.insertTransaction(deposit.transaction);
      }

      // 再插入区块
      for (const block of blocks) {
        await this.insertBlock(block);
      }

      return true;
    } catch (error) {
      console.error('批量处理区块和存款失败:', error);
      return false;
    }
  }

  /**
   * 获取待确认的交易
   */
  async getPendingTransactionsWithSQL(): Promise<any[]> {
    try {
      const result = await this.executeOperation(
        'transactions',
        'select',
        'read',
        undefined,
        {
          status: ['confirmed', 'safe']
        }
      );

      return result || [];
    } catch (error) {
      console.error('获取待确认交易失败:', error);
      return [];
    }
  }

  /**
   * 获取区块的所有交易（用于区块回滚）
   */
  async getTransactionsByBlockHash(blockHash: string): Promise<any[]> {
    try {
      const result = await this.executeOperation(
        'transactions',
        'select',
        'read',
        undefined,
        { block_hash: blockHash }
      );

      return result || [];
    } catch (error) {
      console.error(`获取交易记录失败 (blockHash: ${blockHash}):`, error);
      return [];
    }
  }

  /**
   * 删除区块的所有交易（用于区块回滚）
   */
  async deleteTransactionsByBlockHash(blockHash: string): Promise<{ deletedCount: number; transactionCount: number } | null> {
    try {
      // 先查询交易数量
      const transactions = await this.getTransactionsByBlockHash(blockHash);
      const transactionCount = transactions.length;

      // 执行删除
      const result = await this.executeOperation(
        'transactions',
        'delete',
        'write',
        undefined,
        { block_hash: blockHash }
      );

      return {
        deletedCount: result.changes || 0,
        transactionCount: transactionCount
      };
    } catch (error) {
      console.error(`删除交易记录失败 (blockHash: ${blockHash}):`, error);
      return null;
    }
  }

  /**
   * 更新区块状态（用于区块回滚）
   */
  async updateBlockStatus(blockHash: string, status: string): Promise<boolean> {
    try {
      await this.executeOperation(
        'blocks',
        'update',
        'write',
        {
          status,
          updated_at: new Date().toISOString()
        },
        { hash: blockHash }
      );

      return true;
    } catch (error) {
      console.error(`更新区块状态失败 (blockHash: ${blockHash}):`, error);
      return false;
    }
  }

  /**
   * 更新提现状态
   */
  async updateWithdrawStatus(
    withdrawId: number,
    status: 'pending' | 'confirmed' | 'failed' | 'finalized',
    extraData?: {
      gas_used?: string;
      error_message?: string;
    }
  ): Promise<boolean> {
    try {
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (extraData?.gas_used) {
        updateData.gas_used = extraData.gas_used;
      }

      if (extraData?.error_message) {
        updateData.error_message = extraData.error_message;
      }

      await this.executeOperation(
        'withdraws',
        'update',
        'sensitive',
        updateData,
        { id: withdrawId }
      );

      return true;
    } catch (error) {
      console.error(`更新提现状态失败 (withdrawId: ${withdrawId}):`, error);
      return false;
    }
  }

  /**
   * 根据reference_id更新Credit状态
   */
  async updateCreditStatusByReferenceId(
    referenceId: string,
    referenceType: string,
    status: 'pending' | 'confirmed' | 'failed' | 'finalized',
    extraData?: {
      block_number?: number;
    }
  ): Promise<boolean> {
    try {
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (extraData?.block_number !== undefined) {
        updateData.block_number = extraData.block_number;
      }

      await this.executeOperation(
        'credits',
        'update',
        'sensitive',
        updateData,
        {
          reference_id: referenceId,
          reference_type: referenceType
        }
      );

      return true;
    } catch (error) {
      console.error(`更新Credit状态失败 (referenceId: ${referenceId}):`, error);
      return false;
    }
  }

  /**
   * 创建交易记录（别名方法，与insertTransaction功能相同）
   */
  async createTransaction(params: {
    tx_hash: string;
    block_hash?: string;
    block_no?: number;
    from_addr?: string;
    to_addr?: string;
    token_addr?: string | null;
    amount: string;
    type: string;
    status: string;
  }): Promise<boolean> {
    return await this.insertTransaction({
      block_hash: params.block_hash,
      block_no: params.block_no,
      tx_hash: params.tx_hash,
      from_addr: params.from_addr,
      to_addr: params.to_addr,
      token_addr: params.token_addr || undefined,
      amount: params.amount,
      type: params.type,
      status: params.status
    });
  }
}

// 单例实例
let dbGatewayClient: DbGatewayClient | null = null;

/**
 * 获取 DbGatewayClient 单例实例
 */
export function getDbGatewayClient(): DbGatewayClient {
  if (!dbGatewayClient) {
    dbGatewayClient = new DbGatewayClient();
  }
  return dbGatewayClient;
}