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

  // 大额交易阈值（单位：wei，测试设置为 0.5 ETH， 应该用数据库定义规则）
  private readonly LARGE_AMOUNT_THRESHOLD = BigInt('500000000000000000');

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
      const riskCheck = await this.checkRiskRules(request);

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
      const assessmentId = await this.assessmentModel.create({
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
        // 通过 prepareDbOperation 处理数据（会修改 status 等字段）
        const dbOperation = this.prepareDbOperation(request, riskCheck.decision, riskCheck.reasons);

        // 创建签名负载（对修改后的数据签名）
        const rejectSignaturePayload: SignaturePayload = {
          operation_id,
          operation_type: request.operation_type,
          table: dbOperation.table,
          action: dbOperation.action,
          data: dbOperation.data,
          conditions: dbOperation.conditions,
          timestamp
        };

        const rejectSignature = this.signer.sign(rejectSignaturePayload);

        logger.info('Risk assessment completed - REJECTED', {
          operation_id,
          decision: 'reject',
          risk_level: riskCheck.risk_level,
          reasons: riskCheck.reasons,
          has_suggestion: !!riskCheck.suggestData,
          assessment_id: assessmentId
        });

        return {
          success: false,
          decision: 'reject',
          operation_id,
          db_operation: dbOperation,
          suggest_operation_data: riskCheck.suggestData ? riskCheck.suggestData : undefined,
          suggest_reason: riskCheck.suggestReason,
          risk_signature: rejectSignature,
          timestamp,
          risk_level: riskCheck.risk_level,
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
        reasons: riskCheck.reasons
      };

      logger.info('Risk assessment completed', {
        operation_id,
        decision: riskCheck.decision,
        risk_level: riskCheck.risk_level,
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
  private async checkRiskRules(request: RiskAssessmentRequest): Promise<{
    decision: RiskDecision;
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    reasons: string[];
    suggestData?: any;
    suggestReason?: string;
  }> {
    const reasons: string[] = [];
    const ctx = request.context || {};
    let suggestData: any = undefined;
    let suggestReason: string | undefined = undefined;

    // 规则1: 检查黑名单地址
    const fromAddress = ctx.from_address || request.data?.from_address;
    const creditType = ctx.credit_type || request.data?.credit_type;

    console.log('fromAddress', fromAddress);
    console.log('creditType', creditType);

    // 检查 from_address（主要用于存款场景）
    if (fromAddress) {
      const chainType = ctx.chain_type || 'evm';
      const riskInfo = await this.addressRiskModel.checkAddress(fromAddress, chainType);
      if (riskInfo && riskInfo.risk_type === 'blacklist') {
        reasons.push(`From address is blacklisted: ${riskInfo.reason || 'Unknown reason'}`);

        // 如果是存款，冻结而不是拒绝（允许记录但冻结资金）
        if (creditType === 'deposit') {
          return {
            decision: 'freeze',
            risk_level: 'critical',
            reasons,
            suggestData,
            suggestReason
          };
        }

        // 其他情况直接拒绝
        return {
          decision: 'reject',
          risk_level: 'critical',
          reasons,
          suggestData,
          suggestReason
        };
      }
    }

    // 检查 to_address（主要用于提现场景）
    const toAddress = ctx.to_address || request.data?.to_address;
    if (toAddress) {
      const chainType = ctx.chain_type || 'evm';
      const riskInfo = await this.addressRiskModel.checkAddress(toAddress, chainType);
      if (riskInfo && riskInfo.risk_type === 'blacklist') {
        reasons.push(`To address is blacklisted: ${riskInfo.reason || 'Unknown reason'}`);
        // 提现到黑名单地址，直接拒绝
        return {
          decision: 'reject',
          risk_level: 'critical',
          reasons,
          suggestData,
          suggestReason
        };
      }
    }

    // 规则2: 检查高风险用户 - 人工审核
    const userId = ctx.user_id || request.data?.user_id;
    if (userId && this.highRiskUsers.has(userId)) {
      reasons.push('User is marked as high risk');
      reasons.push('Manual review required');
      return {
        decision: 'manual_review',
        risk_level: 'high',
        reasons,
        suggestData,
        suggestReason
      };
    }

    // 规则3: 检查大额提现 - 人工审核（只检查提现，不检查存款）
    const amount = ctx.amount || request.data?.amount;
    const isWithdraw = creditType === 'withdraw' || request.table === 'withdraws';

    if (amount && isWithdraw) {
      try {
        const amountBigInt = BigInt(amount);
        if (amountBigInt > this.LARGE_AMOUNT_THRESHOLD) {
          reasons.push(`Large amount withdrawal: ${amount}`);
          reasons.push('Manual review required');

          // 生成建议数据：建议减少金额到阈值以下
          const suggestedAmount = this.LARGE_AMOUNT_THRESHOLD.toString();
          suggestData = {
            ...request.data,
            amount: suggestedAmount
          };
          suggestReason = `建议金额过大，建议分批提现，单次建议金额: ${suggestedAmount}`;

          return {
            decision: 'manual_review',
            risk_level: 'high',
            reasons,
            suggestData,
            suggestReason
          };
        }
      } catch (error) {
        logger.warn('Failed to parse amount', { amount });
      }
    }

    // 默认：批准
    if (reasons.length === 0) {
      reasons.push('Normal transaction');
    }

    return {
      decision: 'approve',
      risk_level: 'low',
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
    decision: RiskDecision,
    reasons?: string[]
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

    // 如果是冻结决策，修改 status 字段（针对 credits 表的 deposit）
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

    // 如果是拒绝决策，修改 status 和 error_message 字段（针对 withdraws 表）
    if (decision === 'reject' && request.table === 'withdraws' && dbOperation.data) {
      dbOperation.data.status = 'rejected';
      if (reasons && reasons.length > 0) {
        dbOperation.data.error_message = reasons.join(', ');
      }
    }

    // 如果是人工审核决策，修改 status 字段（针对 withdraws 表）
    if (decision === 'manual_review' && request.table === 'withdraws' && dbOperation.data) {
      dbOperation.data.status = 'manual_review';
      if (reasons && reasons.length > 0) {
        dbOperation.data.error_message = reasons.join(', ');
      }
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
   * 对消息进行签名（供 Controller 使用）
   */
  signMessage(message: string): string {
    return this.signer.signMessage(message);
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
