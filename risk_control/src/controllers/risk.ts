import { Request, Response } from 'express';
import { RiskAssessmentService } from '../services/risk-assessment';
import { ManualReviewService } from '../services/manual-review';
import { RiskAssessmentRequest } from '../types';
import { logger } from '../utils/logger';
import { Ed25519Signer } from '../utils/crypto';
import { riskControlDB } from '../db/connection';
import { RiskAssessmentModel, AddressRiskModel } from '../db/models';

export class RiskController {
  private manualReviewService: ManualReviewService;
  private riskAssessmentModel: RiskAssessmentModel;
  private addressRiskModel: AddressRiskModel;

  constructor(private riskService: RiskAssessmentService) {
    this.manualReviewService = new ManualReviewService();
    this.riskAssessmentModel = new RiskAssessmentModel(riskControlDB);
    this.addressRiskModel = new AddressRiskModel(riskControlDB);
  }

  /**
   * 评估操作风险
   */
  assessRisk = async (req: Request, res: Response) => {
    try {
      const request = req.body as RiskAssessmentRequest;

      if (!request.operation_id || !request.operation_type || !request.table || !request.action || !request.timestamp) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing required fields',
            details: 'operation_id, operation_type, table, action, and timestamp are required'
          }
        });
      }

      // 执行风控评估
      const assessment = await this.riskService.assessRisk(request);

      // 根据决策返回不同的状态码
      if (assessment.decision === 'reject') {
        return res.status(403).json(assessment);
      }

      if (assessment.decision === 'manual_review') {
        return res.status(202).json(assessment);
      }

      // approve 或 freeze 都返回 200
      return res.status(200).json(assessment);

    } catch (error) {
      logger.error('Risk assessment endpoint error', { error, body: req.body });
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  /**
   * 提交人工审核结果
   */
  submitManualReview = async (req: Request, res: Response) => {
    try {
      const { operation_id, approver_user_id, approver_username, approved, modified_data, comment } = req.body;

      if (!operation_id || approver_user_id === undefined || approved === undefined) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing required fields',
            details: 'operation_id, approver_user_id, and approved are required'
          }
        });
      }

      const result = await this.manualReviewService.submitReview({
        operation_id,
        approver_user_id,
        approver_username,
        approved,
        modified_data,
        comment,
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      return res.status(200).json(result);

    } catch (error) {
      logger.error('Submit manual review endpoint error', { error, body: req.body });
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  /**
   * 获取待审核列表
   */
  getPendingReviews = async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const result = await this.manualReviewService.getPendingReviews(limit);

      return res.status(200).json(result);

    } catch (error) {
      logger.error('Get pending reviews endpoint error', { error });
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  /**
   * 获取审核历史
   */
  getReviewHistory = async (req: Request, res: Response) => {
    try {
      const { operation_id } = req.params;

      if (!operation_id) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing operation_id parameter'
          }
        });
      }

      const result = await this.manualReviewService.getReviewHistory(operation_id);

      return res.status(200).json(result);

    } catch (error) {
      logger.error('Get review history endpoint error', { error });
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  /**
   * 对提现进行风险评估并签名
   */
  withdrawRiskAssessment = async (req: Request, res: Response) => {
    try {
      const { operation_id, transaction, timestamp } = req.body;

      // 验证必需参数
      if (!operation_id || !transaction || !timestamp) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing required fields',
            details: 'operation_id, transaction, and timestamp are required'
          }
        });
      }

      const { from, to, amount, tokenAddress, chainId, nonce } = transaction;

      if (!from || !to || !amount || chainId === undefined || nonce === undefined) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing transaction fields',
            details: 'from, to, amount, chainId, and nonce are required'
          }
        });
      }

      // 风控检查
      let decision: 'approve' | 'freeze' | 'reject' | 'manual_review' = 'approve'; // 默认批准
      const reasons: string[] = [];
      let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

      // 1. 检查目标地址黑名单
      // 根据 chainId 判断链类型
      let chainTypeStr: 'evm' | 'btc' | 'solana' = 'evm';
      // 简化处理，假设都是 EVM 链，未来可以根据 chainId 映射

      const addressRisk = await this.addressRiskModel.checkAddress(to, chainTypeStr);

      if (addressRisk && addressRisk.risk_type === 'blacklist') {
        decision = 'reject';
        reasons.push(`目标地址在黑名单中: ${addressRisk.reason || '未知原因'}`);
        riskLevel = 'critical';

        logger.warn('Withdraw rejected - blacklisted address', {
          operation_id,
          to,
          reason: addressRisk.reason
        });
      }

      // TODO: 可以添加更多风控规则
      // 2. 检查金额限制
      // 3. 检查频率限制
      // 4. 检查单日额度

      // 如果被拒绝，直接返回，不生成签名
      if (decision === 'reject') {
        // 记录到数据库
        await this.riskAssessmentModel.create({
          operation_id,
          table_name: undefined,
          action: 'withdraw',
          operation_data: JSON.stringify({
            from,
            to,
            amount,
            tokenAddress: tokenAddress || null,
            chainId,
            nonce,
            timestamp
          }),
          risk_level: riskLevel,
          decision: 'deny',
          reasons: reasons.length > 0 ? JSON.stringify(reasons) : undefined,
          risk_signature: undefined,  // 不生成签名
          expires_at: undefined
        });

        logger.info('Withdraw risk assessment completed - REJECTED', {
          operation_id,
          from,
          to,
          amount,
          decision,
          risk_level: riskLevel,
          reasons
        });

        // 返回 403 状态码
        return res.status(403).json({
          success: false,
          decision,
          timestamp,
          reasons,
          error: {
            code: 'RISK_REJECTED',
            message: '提现被风控拒绝',
            details: reasons.join('; ')
          }
        });
      }

      // 通过风控检查，生成签名
      const privateKey = process.env.RISK_CONTROL_PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('RISK_CONTROL_PRIVATE_KEY not configured');
      }

      const signer = new Ed25519Signer(privateKey);
      const signPayload = JSON.stringify({
        operation_id,
        from,
        to,
        amount,
        tokenAddress: tokenAddress || null,
        chainId,
        nonce,
        timestamp
      });

      const riskSignature = signer.signMessage(signPayload);

      // 记录到数据库
      // 计算签名过期时间（5分钟后）
      const expiresAt = new Date(timestamp + 5 * 60 * 1000).toISOString();

      await this.riskAssessmentModel.create({
        operation_id,
        table_name: undefined,  // 提现不对应具体数据库表
        action: 'withdraw',
        operation_data: JSON.stringify({
          from,
          to,
          amount,
          tokenAddress: tokenAddress || null,
          chainId,
          nonce,
          timestamp
        }),
        risk_level: riskLevel,
        decision: decision === 'approve' ? 'auto_approve' : 'manual_review',
        reasons: reasons.length > 0 ? JSON.stringify(reasons) : undefined,
        risk_signature: riskSignature,
        expires_at: expiresAt
      });

      logger.info('Withdraw risk assessment completed - APPROVED', {
        operation_id,
        from,
        to,
        amount,
        decision,
        risk_level: riskLevel
      });

      return res.status(200).json({
        success: true,
        risk_signature: riskSignature,
        decision,
        timestamp,
        reasons
      });

    } catch (error) {
      logger.error('Withdraw risk assessment endpoint error', { error, body: req.body });
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };
}
