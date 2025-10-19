import { v4 as uuidv4 } from 'uuid';
import { Ed25519Signer, SignaturePayload } from '../utils/crypto';
import logger from '../utils/logger';
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

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }
  return error;
}

function sanitizeValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'bigint') {
    const numericValue = Number(value);
    return (Number.isSafeInteger(numericValue) ? numericValue : value.toString()) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item)) as unknown as T;
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, val] of Object.entries(value as Record<string, any>)) {
      sanitized[key] = sanitizeValue(val);
    }
    return sanitized as T;
  }

  return value;
}

export class DbGatewayClient {
  private baseUrl: string;
  private signer: Ed25519Signer;
  private riskControlClient = getRiskControlClient();

  constructor(baseUrl: string = process.env.DB_GATEWAY_URL || 'http://localhost:3003') {
    this.baseUrl = baseUrl;
    this.signer = new Ed25519Signer();
  }

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
      let riskSignature: string | undefined;
      let requestTable = table;
      let requestAction = action;

      if (operationType === 'sensitive') {
        const riskResult = await this.riskControlClient.requestRiskAssessment({
          operation_id: operationId,
          operation_type: operationType,
          table,
          action,
          data,
          conditions,
          timestamp
        });

        if (!riskResult) {
          throw new Error('风控服务未返回结果');
        }

        if (!riskResult.risk_signature) {
          throw new Error('风控服务未返回签名');
        }

        if (!riskResult.success && riskResult.decision === 'reject') {
          const reason = riskResult.reasons?.join(', ') || '风控拒绝';
          throw new Error(`风控拒绝敏感操作: ${reason}`);
        }

        riskSignature = riskResult.risk_signature;

        if (riskResult.db_operation?.table) {
          requestTable = riskResult.db_operation.table;
        }

        if (riskResult.db_operation?.action) {
          requestAction = riskResult.db_operation.action;
        }

        if (riskResult.db_operation?.data !== undefined) {
          data = riskResult.db_operation.data;
        }

        if (riskResult.db_operation?.conditions !== undefined) {
          conditions = riskResult.db_operation.conditions;
        }

        logger.info('风控评估完成', {
          operationId,
          decision: riskResult.decision,
          reasons: riskResult.reasons,
          table: requestTable,
          action: requestAction
        });
      }

      const sanitizedData = sanitizeValue(data ?? null);
      const sanitizedConditions = sanitizeValue(conditions ?? null);

      const signaturePayload: SignaturePayload = {
        operation_id: operationId,
        operation_type: operationType,
        table: requestTable,
        action: requestAction,
        data: sanitizedData,
        conditions: sanitizedConditions,
        timestamp
      };

      const signature = this.signer.sign(signaturePayload);

      const gatewayRequest: GatewayRequest = {
        operation_id: operationId,
        operation_type: operationType,
        table: requestTable,
        action: requestAction,
        data: sanitizedData === null ? undefined : sanitizedData,
        conditions: sanitizedConditions === null ? undefined : sanitizedConditions,
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
      logger.error('数据库操作失败', { table, action, error: normalizeError(error) });
      throw error;
    }
  }

  /**
   * 插入Solana槽位记录
   */
  async insertSolanaSlot(params: {
    slot: number;
    block_hash?: string;
    parent_slot?: number;
    block_time?: number;
    status?: string;
  }): Promise<boolean> {
    try {
      const data = {
        slot: params.slot,
        block_hash: params.block_hash || null,
        parent_slot: params.parent_slot || null,
        block_time: params.block_time || null,
        status: params.status || 'confirmed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // 检查是否已存在
      const existing = await this.executeOperation(
        'solana_slots',
        'select',
        'read',
        undefined,
        { slot: params.slot }
      );

      if (existing && existing.length > 0) {
        // 更新
        await this.executeOperation(
          'solana_slots',
          'update',
          'write',
          {
            block_hash: data.block_hash,
            parent_slot: data.parent_slot,
            block_time: data.block_time,
            status: data.status,
            updated_at: data.updated_at
          },
          { slot: params.slot }
        );
      } else {
        // 插入
        await this.executeOperation('solana_slots', 'insert', 'write', data);
      }

      return true;
    } catch (error) {
      logger.error('插入Solana槽位记录失败', { slot: params.slot, error: normalizeError(error) });
      return false;
    }
  }

  /**
   * 更新Solana槽位状态
   */
  async updateSolanaSlotStatus(slot: number, status: string): Promise<boolean> {
    try {
      await this.executeOperation(
        'solana_slots',
        'update',
        'write',
        {
          status,
          updated_at: new Date().toISOString()
        },
        { slot }
      );

      return true;
    } catch (error) {
      logger.error('更新Solana槽位状态失败', { slot, error: normalizeError(error) });
      return false;
    }
  }

  /**
   * 插入Solana交易记录
   */
  async insertSolanaTransaction(params: {
    slot: number;
    tx_hash: string;
    from_addr?: string;
    to_addr: string;
    token_mint?: string;
    amount: string;
    type?: string;
    status?: string;
    block_time?: number;
  }): Promise<boolean> {
    try {
      const data = {
        slot: params.slot,
        tx_hash: params.tx_hash,
        from_addr: params.from_addr || null,
        to_addr: params.to_addr,
        token_mint: params.token_mint || null,
        amount: params.amount,
        type: params.type || 'deposit',
        status: params.status || 'confirmed',
        block_time: params.block_time || null,
        created_at: new Date().toISOString()
      };

      await this.executeOperation('solana_transactions', 'insert', 'write', data);
      return true;
    } catch (error) {
      logger.error('插入Solana交易记录失败', { txHash: params.tx_hash, error: normalizeError(error) });
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
    reference_id?: number | string;
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
      let referenceId = params.reference_id;
      if (!referenceId && params.credit_type === 'deposit' && params.tx_hash) {
        referenceId = `${params.tx_hash}_${params.event_index || 0}`;
      }

      if (!referenceId) {
        throw new Error('reference_id is required');
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
        chain_type: params.chain_type || 'solana',
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
    } catch (error: any) {
      if (error?.message?.includes('UNIQUE') || error?.message?.includes('constraint')) {
        logger.debug('Credit记录已存在', { txHash: params.tx_hash });
        return null;
      }
      logger.error('创建credit记录失败', { error: normalizeError(error) });
      return null;
    }
  }

  /**
   * 更新Solana交易状态
   */
  async updateSolanaTransactionStatus(txHash: string, status: string): Promise<boolean> {
    try {
      await this.executeOperation(
        'solana_transactions',
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
      logger.error('更新Solana交易状态失败', { txHash, error });
      return false;
    }
  }

  /**
   * 更新credit状态
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
      logger.error('更新credit状态失败', { txHash, error });
      return false;
    }
  }

  /**
   * 删除槽位范围内的Credit记录
   */
  async deleteCreditsBySlotRange(startSlot: number, endSlot: number): Promise<number> {
    try {
      const result = await this.executeOperation(
        'credits',
        'delete',
        'sensitive',
        undefined,
        {
          block_number: {
            '>=': startSlot,
            '<=': endSlot
          },
          chain_type: 'solana'
        }
      );

      return result.changes || 0;
    } catch (error) {
      logger.error('删除Credit记录失败', { startSlot, endSlot, error });
      return 0;
    }
  }

  /**
   * 删除Solana交易记录
   */
  async deleteSolanaTransaction(txHash: string): Promise<boolean> {
    try {
      const result = await this.executeOperation(
        'solana_transactions',
        'delete',
        'write',
        undefined,
        { tx_hash: txHash }
      );
      return result && result.changes > 0;
    } catch (error) {
      logger.error('删除Solana交易记录失败', { txHash, error });
      return false;
    }
  }

  /**
   * 删除槽位的所有Solana交易
   */
  async deleteSolanaTransactionsBySlot(slot: number): Promise<number> {
    try {
      const result = await this.executeOperation(
        'solana_transactions',
        'delete',
        'write',
        undefined,
        { slot }
      );
      return result.changes || 0;
    } catch (error) {
      logger.error('删除槽位的Solana交易失败', { slot, error });
      return 0;
    }
  }
}

// 单例实例
let dbGatewayClient: DbGatewayClient | null = null;

export function getDbGatewayClient(): DbGatewayClient {
  if (!dbGatewayClient) {
    dbGatewayClient = new DbGatewayClient();
  }
  return dbGatewayClient;
}
