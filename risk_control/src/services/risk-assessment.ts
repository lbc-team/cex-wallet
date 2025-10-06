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
import { riskControlDB } from '../db/connection';
import { RiskAssessmentModel, AddressRiskModel } from '../db/models';

export class RiskAssessmentService {
  private signer: Ed25519Signer;
  private assessmentModel: RiskAssessmentModel;
  private addressRiskModel: AddressRiskModel;

  // 大额交易阈值（单位：wei，这里设置为 10 ETH）
  private readonly LARGE_AMOUNT_THRESHOLD = BigInt('10000000000000000000');

  // 高风险用户列表（模拟，后续可以移到数据库）
  private highRiskUsers: Set<number> = new Set([666, 999]);

  constructor(privateKeyHex: string) {
    this.signer = new Ed25519Signer(privateKeyHex);
    this.assessmentModel = new RiskAssessmentModel(riskControlDB);
    this.addressRiskModel = new AddressRiskModel(riskControlDB);

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
      const timestamp = request.timestamp;

      // 2. 执行风控规则检查
      const riskCheck = this.checkRiskRules(request);

      // 3. 根据决策修改数据（如 freeze）
      const dbOperation = this.prepareDbOperation(request, riskCheck.decision);

      // 4. 创建签名负载
      const signaturePayload: SignaturePayload = {
        operation_id,
        operation_type: request.operation_type,
        table: dbOperation.table,
        action: dbOperation.action,
        data: dbOperation.data,
        conditions: dbOperation.conditions,
        timestamp
      };

      // 5. 对操作进行签名
      const risk_signature = this.signer.sign(signaturePayload);

      // 6. 保存风控评估记录到数据库
      const assessmentId = this.assessmentModel.create({
        operation_id,
        table_name: request.table,
        action: request.action,
        user_id: request.context?.user_id,
        operation_data: JSON.stringify(request.data || {}),
        suggest_operation_data: riskCheck.suggestData ? JSON.stringify(riskCheck.suggestData) : undefined,
        suggest_reason: riskCheck.suggestReason,
        risk_level: riskCheck.risk_level,
        decision: riskCheck.decision === 'approve' ? 'auto_approve' :
                  riskCheck.decision === 'manual_review' ? 'manual_review' : 'deny',
        approval_status: riskCheck.decision === 'manual_review' ? 'pending' : undefined,
        reasons: JSON.stringify(riskCheck.reasons),
        risk_signature,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24小时过期
      });

      // 7. 如果被拒绝，返回错误（但可能包含建议数据）
      if (riskCheck.decision === 'reject') {
        // 准备响应数据（优先使用建议数据）
        const responseData = riskCheck.suggestData || request.data;

        // 创建签名负载（对建议数据签名）
        const rejectSignaturePayload: SignaturePayload = {
          operation_id,
          operation_type: request.operation_type,
          table: request.table,
          action: request.action,
          data: responseData,
          conditions: request.conditions,
          timestamp
        };

        const rejectSignature = this.signer.sign(rejectSignaturePayload);

        return {
          success: false,
          decision: 'reject',
          operation_id,
          db_operation: {
            table: request.table,
            action: request.action,
            data: responseData,
            conditions: request.conditions
          },
          suggest_operation_data: riskCheck.suggestData ? riskCheck.suggestData : undefined,
          suggest_reason: riskCheck.suggestReason,
          risk_signature: rejectSignature,
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

      // 8. 返回评估结果
      const response: RiskAssessmentResponse = {
        success: true,
        decision: riskCheck.decision,
        operation_id,
        db_operation: dbOperation,
        suggest_operation_data: riskCheck.suggestData,
        suggest_reason: riskCheck.suggestReason,
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
        risk_score: riskCheck.risk_score,
        has_suggestion: !!riskCheck.suggestData,
        assessment_id: assessmentId
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
    suggestData?: any;
    suggestReason?: string;
  } {
    const reasons: string[] = [];
    let risk_score = 0;
    const ctx = request.context || {};

    // 规则1: 检查黑名单地址（从数据库读取）
    const fromAddress = ctx.from_address || request.data?.from_address;
    if (fromAddress) {
      const chainType = ctx.chain_type || 'evm';
      const riskInfo = this.addressRiskModel.checkAddress(fromAddress, chainType);
      if (riskInfo && riskInfo.risk_type === 'blacklist') {
        reasons.push(`From address is blacklisted: ${riskInfo.reason || 'Unknown reason'}`);
        risk_score += 100;
      }
    }

    const toAddress = ctx.to_address || request.data?.to_address;
    if (toAddress) {
      const chainType = ctx.chain_type || 'evm';
      const riskInfo = this.addressRiskModel.checkAddress(toAddress, chainType);
      if (riskInfo && riskInfo.risk_type === 'blacklist') {
        reasons.push(`To address is blacklisted: ${riskInfo.reason || 'Unknown reason'}`);
        risk_score += 100;
      }
    }

    // 规则2: 检查高风险用户
    const userId = ctx.user_id || request.data?.user_id;
    if (userId && this.highRiskUsers.has(userId)) {
      reasons.push('User is marked as high risk');
      risk_score += 50;
    }

    // 规则3: 检查大额交易
    const amount = ctx.amount || request.data?.amount;
    let suggestData: any = undefined;
    let suggestReason: string | undefined = undefined;

    if (amount) {
      try {
        const amountBigInt = BigInt(amount);
        if (amountBigInt > this.LARGE_AMOUNT_THRESHOLD) {
          reasons.push(`Large amount transaction: ${amount}`);
          risk_score += 30;

          // 生成建议数据：建议减少金额到阈值以下
          const suggestedAmount = (this.LARGE_AMOUNT_THRESHOLD / BigInt(2)).toString();
          suggestData = {
            ...request.data,
            amount: suggestedAmount
          };
          suggestReason = `建议金额过大，建议分批提现，单次建议金额: ${suggestedAmount}`;
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
      // 高风险：直接拒绝（黑名单地址）
      decision = 'reject';
      risk_level = 'critical';
      reasons.push('Transaction rejected due to critical risk');
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

    return {
      decision,
      risk_level,
      risk_score,
      reasons,
      suggestData,
      suggestReason
    };
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
   * 获取公钥
   */
  getPublicKey(): string {
    return this.signer.getPublicKeyHex();
  }

  /**
   * 获取评估模型（用于其他服务）
   */
  getAssessmentModel(): RiskAssessmentModel {
    return this.assessmentModel;
  }

  /**
   * 获取地址风险模型（用于其他服务）
   */
  getAddressRiskModel(): AddressRiskModel {
    return this.addressRiskModel;
  }
}
