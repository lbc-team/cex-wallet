import { logger } from '../utils/logger';
import { GatewayRequest } from '../types';

export interface RiskAssessment {
  operation_id: string;
  risk_score: number;
  risk_level: 'low' | 'medium' | 'high';
  decision: 'auto_approve' | 'manual_review' | 'deny';
  reasons: string[];
  required_approvals: number;
  expires_at: Date;
}

export interface RiskRule {
  id: string;
  name: string;
  description: string;
  table: string;
  conditions: any;
  risk_weight: number;
  enabled: boolean;
}

export class RiskControlService {
  private riskRules: RiskRule[] = [];

  constructor() {
    this.initializeDefaultRules();
  }

  private initializeDefaultRules() {
    // 默认风控规则
    this.riskRules = [
      {
        id: 'large_amount_withdraw',
        name: 'Large Amount Withdrawal',
        description: 'Withdrawals over threshold require manual review',
        table: 'withdraws',
        conditions: {
          amount: { '>': '10000000000000000000000' }, // > 10000 tokens (18 decimals)
        },
        risk_weight: 50,
        enabled: true
      },
      {
        id: 'frequent_withdrawals',
        name: 'Frequent Withdrawals',
        description: 'Multiple withdrawals in short time period',
        table: 'withdraws',
        conditions: {
          // 这里需要更复杂的时间窗口逻辑
        },
        risk_weight: 30,
        enabled: true
      },
      {
        id: 'new_address_withdraw',
        name: 'New Address Withdrawal',
        description: 'Withdrawal to a new/unknown address',
        table: 'withdraws',
        conditions: {
          // 需要检查地址历史
        },
        risk_weight: 25,
        enabled: true
      },
      {
        id: 'credit_manipulation',
        name: 'Credit Manipulation',
        description: 'Large credit operations require review',
        table: 'credits',
        conditions: {
          amount: { '>': '5000000000000000000000' }, // > 5000 tokens
          credit_type: 'deposit'
        },
        risk_weight: 40,
        enabled: true
      }
    ];

    logger.info('Risk control rules initialized', { ruleCount: this.riskRules.length });
  }

  /**
   * 评估操作风险
   */
  async assessRisk(request: GatewayRequest): Promise<RiskAssessment> {
    try {
      logger.debug('Starting risk assessment', {
        operation_id: request.operation_id,
        table: request.table,
        action: request.action,
        operation_type: request.operation_type
      });

      // 只有敏感操作才需要风控评估
      if (request.operation_type !== 'sensitive') {
        return this.createLowRiskAssessment(request.operation_id);
      }

      let totalRiskScore = 0;
      const triggeredRules: string[] = [];

      // 检查所有相关的风控规则
      for (const rule of this.riskRules) {
        if (!rule.enabled) continue;

        if (rule.table === request.table || rule.table === '*') {
          const ruleTriggered = await this.evaluateRule(rule, request);
          if (ruleTriggered) {
            totalRiskScore += rule.risk_weight;
            triggeredRules.push(rule.name);

            logger.warn('Risk rule triggered', {
              operation_id: request.operation_id,
              rule: rule.name,
              weight: rule.risk_weight
            });
          }
        }
      }

      // 根据总风险分数确定风险等级和决策
      const assessment = this.calculateRiskAssessment(
        request.operation_id,
        totalRiskScore,
        triggeredRules
      );

      logger.info('Risk assessment completed', {
        operation_id: request.operation_id,
        risk_score: assessment.risk_score,
        risk_level: assessment.risk_level,
        decision: assessment.decision,
        triggered_rules: triggeredRules.length
      });

      return assessment;

    } catch (error) {
      logger.error('Risk assessment failed', {
        operation_id: request.operation_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // 失败时默认需要人工审核
      return {
        operation_id: request.operation_id,
        risk_score: 100,
        risk_level: 'high',
        decision: 'manual_review',
        reasons: ['Risk assessment system error'],
        required_approvals: 2,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24小时后过期
      };
    }
  }

  private async evaluateRule(rule: RiskRule, request: GatewayRequest): Promise<boolean> {
    try {
      // 这里实现具体的规则评估逻辑
      // 目前是简化版本，实际应该根据规则条件和请求数据进行复杂计算

      if (!request.data) return false;

      // 检查金额条件
      if (rule.conditions.amount) {
        const requestAmount = request.data.amount;
        if (!requestAmount) return false;

        for (const [operator, value] of Object.entries(rule.conditions.amount)) {
          switch (operator) {
            case '>':
              if (BigInt(requestAmount) <= BigInt(value as string)) return false;
              break;
            case '<':
              if (BigInt(requestAmount) >= BigInt(value as string)) return false;
              break;
            case '>=':
              if (BigInt(requestAmount) < BigInt(value as string)) return false;
              break;
            case '<=':
              if (BigInt(requestAmount) > BigInt(value as string)) return false;
              break;
            case '=':
              if (BigInt(requestAmount) !== BigInt(value as string)) return false;
              break;
          }
        }
      }

      // 检查其他条件
      for (const [field, condition] of Object.entries(rule.conditions)) {
        if (field === 'amount') continue; // 已经检查过了

        const requestValue = request.data[field];
        if (requestValue !== condition) {
          return false;
        }
      }

      return true;

    } catch (error) {
      logger.error('Rule evaluation failed', {
        rule_id: rule.id,
        operation_id: request.operation_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  private createLowRiskAssessment(operationId: string): RiskAssessment {
    return {
      operation_id: operationId,
      risk_score: 0,
      risk_level: 'low',
      decision: 'auto_approve',
      reasons: ['Low risk operation'],
      required_approvals: 0,
      expires_at: new Date(Date.now() + 1 * 60 * 60 * 1000) // 1小时后过期
    };
  }

  private calculateRiskAssessment(
    operationId: string,
    totalScore: number,
    triggeredRules: string[]
  ): RiskAssessment {
    let risk_level: 'low' | 'medium' | 'high';
    let decision: 'auto_approve' | 'manual_review' | 'deny';
    let required_approvals: number;
    let reasons: string[];

    if (totalScore === 0) {
      risk_level = 'low';
      decision = 'auto_approve';
      required_approvals = 0;
      reasons = ['No risk factors detected'];
    } else if (totalScore <= 30) {
      risk_level = 'low';
      decision = 'auto_approve';
      required_approvals = 0;
      reasons = ['Low risk factors detected'];
    } else if (totalScore <= 70) {
      risk_level = 'medium';
      decision = 'manual_review';
      required_approvals = 1;
      reasons = [`Medium risk detected: ${triggeredRules.join(', ')}`];
    } else if (totalScore <= 90) {
      risk_level = 'high';
      decision = 'manual_review';
      required_approvals = 2;
      reasons = [`High risk detected: ${triggeredRules.join(', ')}`];
    } else {
      risk_level = 'high';
      decision = 'deny';
      required_approvals = 0;
      reasons = [`Critical risk detected: ${triggeredRules.join(', ')}`, 'Operation denied by policy'];
    }

    return {
      operation_id: operationId,
      risk_score: totalScore,
      risk_level,
      decision,
      reasons,
      required_approvals,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24小时后过期
    };
  }

  /**
   * 手动审批操作
   */
  async manualApprove(
    operationId: string,
    approverUserId: string,
    approved: boolean,
    comment?: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      // TODO: 实现手动审批逻辑
      // 1. 检查操作是否存在且需要审批
      // 2. 检查审批者权限
      // 3. 记录审批结果
      // 4. 更新操作状态

      logger.info('Manual approval processed', {
        operation_id: operationId,
        approver: approverUserId,
        approved,
        comment
      });

      return {
        success: true,
        message: approved ? 'Operation approved' : 'Operation rejected'
      };

    } catch (error) {
      logger.error('Manual approval failed', {
        operation_id: operationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        message: 'Manual approval processing failed'
      };
    }
  }

  /**
   * 获取待审批操作列表
   */
  async getPendingApprovals(): Promise<any[]> {
    try {
      // TODO: 从数据库查询待审批的操作
      // 这里返回模拟数据
      return [];
    } catch (error) {
      logger.error('Failed to get pending approvals', { error });
      return [];
    }
  }

  /**
   * 添加或更新风控规则
   */
  async updateRiskRule(rule: RiskRule): Promise<void> {
    const existingIndex = this.riskRules.findIndex(r => r.id === rule.id);

    if (existingIndex >= 0) {
      this.riskRules[existingIndex] = rule;
      logger.info('Risk rule updated', { rule_id: rule.id });
    } else {
      this.riskRules.push(rule);
      logger.info('Risk rule added', { rule_id: rule.id });
    }
  }

  /**
   * 禁用风控规则
   */
  async disableRiskRule(ruleId: string): Promise<void> {
    const rule = this.riskRules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = false;
      logger.info('Risk rule disabled', { rule_id: ruleId });
    }
  }

  /**
   * 获取所有风控规则
   */
  getRiskRules(): RiskRule[] {
    return this.riskRules.filter(r => r.enabled);
  }
}