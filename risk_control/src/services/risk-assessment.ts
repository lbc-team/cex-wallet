import { v4 as uuidv4 } from 'uuid';
import { Ed25519Signer } from '../utils/crypto';
import { logger } from '../utils/logger';
import {
  RiskAssessmentRequest,
  RiskAssessmentResponse,
  RiskDecision,
  SignaturePayload,
  BlacklistAddress
} from '../types';

export class RiskAssessmentService {
  private signer: Ed25519Signer;

  // 模拟的黑名单地址
  private blacklistAddresses: Map<string, BlacklistAddress> = new Map([
    ['0xblacklist001', { address: '0xblacklist001', reason: 'Known scammer', added_at: Date.now() }],
    ['0xblacklist002', { address: '0xblacklist002', reason: 'Money laundering', added_at: Date.now() }],
    ['0xBlacklistAddress', { address: '0xBlacklistAddress', reason: 'Test blacklist', added_at: Date.now() }],
  ]);

  // 大额交易阈值（单位：wei，这里设置为 10 ETH）
  private readonly LARGE_AMOUNT_THRESHOLD = BigInt('10000000000000000000');

  // 高风险用户列表（模拟）
  private highRiskUsers: Set<number> = new Set([666, 999]);

  constructor(privateKeyHex: string) {
    this.signer = new Ed25519Signer(privateKeyHex);
    logger.info('Risk Assessment Service initialized', {
      publicKey: this.signer.getPublicKeyHex()
    });
  }

  /**
   * 评估操作风险
   */
  async assessRisk(request: RiskAssessmentRequest): Promise<RiskAssessmentResponse> {
    logger.info('Assessing risk for operation', {
      operation_id: request.operation_id,
      table: request.table,
      action: request.action,
      context: request.context
    });

    try {
      // 1. 使用业务层传入的 operation_id 和 timestamp
      const operation_id = request.operation_id;
      const timestamp = request.timestamp;  // 使用业务层传入的 timestamp

      // 2. 执行风控规则检查
      const riskCheck = this.checkRiskRules(request);

      // 3. 如果被拒绝，直接返回
      if (riskCheck.decision === 'reject') {
        return {
          success: false,
          decision: 'reject',
          operation_id,
          db_operation: {
            table: request.table,
            action: request.action,
            data: request.data,
            conditions: request.conditions
          },
          risk_signature: '',
          timestamp,
          risk_level: riskCheck.risk_level,
          risk_score: riskCheck.risk_score,
          reasons: riskCheck.reasons,
          error: {
            code: 'RISK_CONTROL_REJECTED',
            message: 'Operation rejected by risk control',
            details: riskCheck.reasons
          }
        };
      }

      // 4. 根据决策修改数据（如 freeze）
      const dbOperation = this.prepareDbOperation(request, riskCheck.decision);

      // 5. 创建签名负载
      const signaturePayload: SignaturePayload = {
        operation_id,
        operation_type: request.operation_type,
        table: dbOperation.table,
        action: dbOperation.action,
        data: dbOperation.data,
        conditions: dbOperation.conditions,
        timestamp
      };

      // 6. 对操作进行签名
      const risk_signature = this.signer.sign(signaturePayload);

      // 7. 返回评估结果
      const response: RiskAssessmentResponse = {
        success: true,
        decision: riskCheck.decision,
        operation_id,
        db_operation: dbOperation,
        risk_signature,
        timestamp,
        risk_level: riskCheck.risk_level,
        risk_score: riskCheck.risk_score,
        reasons: riskCheck.reasons
      };

      logger.info('Risk assessment completed', {
        operation_id,
        decision: riskCheck.decision,
        risk_level: riskCheck.risk_level,
        risk_score: riskCheck.risk_score
      });

      return response;

    } catch (error) {
      logger.error('Risk assessment failed', { error, request });
      throw error;
    }
  }

  /**
   * 检查风控规则
   */
  private checkRiskRules(request: RiskAssessmentRequest): {
    decision: RiskDecision;
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    risk_score: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let risk_score = 0;
    const ctx = request.context || {};

    // 规则1: 检查黑名单地址
    const fromAddress = ctx.from_address || request.data?.from_address;
    if (fromAddress && this.blacklistAddresses.has(fromAddress.toLowerCase())) {
      const blacklistInfo = this.blacklistAddresses.get(fromAddress.toLowerCase())!;
      reasons.push(`From address is blacklisted: ${blacklistInfo.reason}`);
      risk_score += 100;
    }

    const toAddress = ctx.to_address || request.data?.to_address;
    if (toAddress && this.blacklistAddresses.has(toAddress.toLowerCase())) {
      const blacklistInfo = this.blacklistAddresses.get(toAddress.toLowerCase())!;
      reasons.push(`To address is blacklisted: ${blacklistInfo.reason}`);
      risk_score += 100;
    }

    // 规则2: 检查高风险用户
    const userId = ctx.user_id || request.data?.user_id;
    if (userId && this.highRiskUsers.has(userId)) {
      reasons.push('User is marked as high risk');
      risk_score += 50;
    }

    // 规则3: 检查大额交易
    const amount = ctx.amount || request.data?.amount;
    if (amount) {
      try {
        const amountBigInt = BigInt(amount);
        if (amountBigInt > this.LARGE_AMOUNT_THRESHOLD) {
          reasons.push(`Large amount transaction: ${amount}`);
          risk_score += 30;
        }
      } catch (error) {
        logger.warn('Failed to parse amount', { amount });
      }
    }

    // 规则4: 敏感操作加分
    if (request.operation_type === 'sensitive') {
      risk_score += 20;
    }

    // 规则5: 提现操作加分（从 context 中读取）
    const creditType = ctx.credit_type || request.data?.credit_type;
    if (creditType === 'withdraw') {
      risk_score += 10;
    }

    // 决策逻辑
    let decision: RiskDecision;
    let risk_level: 'low' | 'medium' | 'high' | 'critical';

    if (risk_score >= 100) {
      // 高风险：冻结
      decision = 'freeze';
      risk_level = 'critical';
      reasons.push('Transaction frozen due to high risk');
    } else if (risk_score >= 70) {
      // 中高风险：人工审核
      decision = 'manual_review';
      risk_level = 'high';
      reasons.push('Manual review required');
    } else if (risk_score >= 40) {
      // 中风险：批准但标记
      decision = 'approve';
      risk_level = 'medium';
      reasons.push('Transaction approved with monitoring');
    } else {
      // 低风险：直接批准
      decision = 'approve';
      risk_level = 'low';
      if (reasons.length === 0) {
        reasons.push('Normal transaction');
      }
    }

    return { decision, risk_level, risk_score, reasons };
  }

  /**
   * 根据风控决策准备数据库操作
   */
  private prepareDbOperation(
    request: RiskAssessmentRequest,
    decision: RiskDecision
  ): {
    table: string;
    action: 'select' | 'insert' | 'update' | 'delete';
    data?: any;
    conditions?: any;
  } {
    const dbOperation = {
      table: request.table,
      action: request.action,
      data: { ...request.data },
      conditions: request.conditions
    };

    // 如果是冻结决策，修改 status 字段
    if (decision === 'freeze' && dbOperation.data) {
      dbOperation.data.status = 'frozen';
      dbOperation.data.credit_type = dbOperation.data.credit_type || 'deposit';

      // 添加风控原因到 metadata
      if (!dbOperation.data.metadata) {
        dbOperation.data.metadata = {};
      }
      if (typeof dbOperation.data.metadata === 'string') {
        try {
          dbOperation.data.metadata = JSON.parse(dbOperation.data.metadata);
        } catch {
          dbOperation.data.metadata = {};
        }
      }
      dbOperation.data.metadata.risk_decision = 'frozen';
      dbOperation.data.metadata.risk_reason = 'Blacklist address detected';
      dbOperation.data.metadata = JSON.stringify(dbOperation.data.metadata);
    }

    // 如果是批准决策，确保 status 正确
    const ctx = request.context || {};
    const creditType = ctx.credit_type || request.data?.credit_type;
    if (decision === 'approve' && dbOperation.data && creditType === 'deposit') {
      dbOperation.data.status = dbOperation.data.status || 'confirmed';
      dbOperation.data.credit_type = 'deposit';
    }

    return dbOperation;
  }

  /**
   * 添加地址到黑名单（用于测试）
   */
  addToBlacklist(address: string, reason: string): void {
    this.blacklistAddresses.set(address.toLowerCase(), {
      address: address.toLowerCase(),
      reason,
      added_at: Date.now()
    });
    logger.info('Address added to blacklist', { address, reason });
  }

  /**
   * 从黑名单移除地址（用于测试）
   */
  removeFromBlacklist(address: string): void {
    this.blacklistAddresses.delete(address.toLowerCase());
    logger.info('Address removed from blacklist', { address });
  }

  /**
   * 获取公钥
   */
  getPublicKey(): string {
    return this.signer.getPublicKeyHex();
  }
}
