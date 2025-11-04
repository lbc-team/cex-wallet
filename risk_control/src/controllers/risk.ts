import { Request, Response } from 'express';
import { RiskAssessmentService } from '../services/risk-assessment';
import { ManualReviewService } from '../services/manual-review';
import { RiskAssessmentRequest } from '../types';
import { logger } from '../utils/logger';
import { riskControlDB } from '../db/connection';
import { RiskAssessmentModel, AddressRiskModel } from '../db/models';

export class RiskController {
  private manualReviewService: ManualReviewService;
  private riskAssessmentModel: RiskAssessmentModel;
  private addressRiskModel: AddressRiskModel;

  constructor(private riskService: RiskAssessmentService) {
    this.manualReviewService = new ManualReviewService(riskService);
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
      logger.error('Risk assessment endpoint error', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : String(error),
        body: req.body
      });
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
      logger.error('Submit manual review endpoint error', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : String(error),
        body: req.body
      });
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
      logger.error('Get pending reviews endpoint error', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : String(error)
      });
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
      logger.error('Get review history endpoint error', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : String(error)
      });
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
      logger.info('📥 Risk: 收到提现风控评估请求', {
        body: req.body,
        operation_id: req.body?.operation_id
      });

      const { operation_id, transaction, timestamp } = req.body;

      // 验证必需参数
      if (!operation_id || !transaction || !timestamp) {
        logger.warn('❌ Risk: 缺少必需参数', {
          has_operation_id: !!operation_id,
          has_transaction: !!transaction,
          has_timestamp: !!timestamp
        });
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing required fields',
            details: 'operation_id, transaction, and timestamp are required'
          }
        });
      }

      logger.info('📋 Risk: 解析交易参数', {
        operation_id,
        transaction: JSON.stringify(transaction, null, 2),
        timestamp
      });

      const {
        from,
        to,
        amount,
        tokenAddress,
        tokenType,
        chainId,
        chainType,
        nonce,
        blockhash,
        lastValidBlockHeight,
        fee
      } = transaction;

      logger.info('📋 Risk: 提取的交易字段', {
        from,
        to,
        amount,
        tokenAddress: tokenAddress || null,
        tokenType: tokenType || null,
        chainId,
        chainType,
        nonce,
        blockhash: blockhash || null,
        lastValidBlockHeight: lastValidBlockHeight || null,
        fee: fee || null
      });

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

      const normalizedChainType: 'evm' | 'btc' | 'solana' =
        chainType === 'solana' ? 'solana' : chainType === 'btc' ? 'btc' : 'evm';

      logger.info('🔍 Risk: 规范化链类型', {
        original: chainType,
        normalized: normalizedChainType
      });

      // 检查该 operation_id 是否已存在评估记录（人工审核通过的情况）
      logger.info('🔍 Risk: 检查已存在的评估记录', { operation_id });
      const existingAssessment = await this.riskAssessmentModel.findByOperationId(operation_id);

      if (existingAssessment) {
        // 如果已经存在评估记录，且审批状态为 approved（人工审核通过）
        if (existingAssessment.approval_status === 'approved') {
          logger.info('Operation already approved by manual review, reusing signature', {
            operation_id,
            decision: existingAssessment.decision,
            approval_status: existingAssessment.approval_status
          });

          // 重新生成签名（因为现在有了 from 和 nonce）
          logger.info('📝 Risk: 构建签名载荷（人工审核通过）', {
            operation_id,
            chainType: normalizedChainType,
            from,
            to,
            amount,
            tokenAddress: tokenAddress || null,
            tokenType: tokenType || null,
            chainId,
            nonce,
            blockhash: blockhash || null,
            lastValidBlockHeight: lastValidBlockHeight || null,
            fee: fee || null,
            timestamp
          });

          const signaturePayload = this.buildSignaturePayload({
            operation_id,
            chainType: normalizedChainType,
            from,
            to,
            amount,
            tokenAddress,
            tokenType,
            chainId,
            nonce,
            blockhash,
            lastValidBlockHeight,
            fee,
            timestamp
          });
          
          logger.info('📋 Risk 签名载荷（对象）:', signaturePayload);
          const signPayload = JSON.stringify(signaturePayload);
          logger.info('📋 Risk 签名载荷（JSON字符串）:', signPayload);

          logger.info('🔐 Risk: 开始生成签名');
          const riskSignature = this.riskService.signMessage(signPayload);
          logger.info('✅ Risk: 签名生成成功', {
            signature: riskSignature,
            signatureLength: riskSignature.length
          });

          // 更新评估记录，添加新的签名
          await this.riskAssessmentModel.update(existingAssessment.id!, {
            operation_data: JSON.stringify({
              ...this.buildSignaturePayload({
                operation_id,
                chainType: normalizedChainType,
                from,
                to,
                amount,
                tokenAddress,
                tokenType,
                chainId,
                nonce,
                blockhash,
                lastValidBlockHeight,
                fee,
                timestamp
              })
            }),
            risk_signature: riskSignature,
            expires_at: new Date(timestamp + 5 * 60 * 1000).toISOString()
          });

          logger.info('✅ Risk: 返回人工审核通过的响应', {
            operation_id,
            risk_signature: riskSignature,
            decision: 'approve'
          });

          return res.status(200).json({
            success: true,
            risk_signature: riskSignature,
            decision: 'approve',
            timestamp,
            reasons: ['Manual review approved']
          });
        }
      }

      // 风控检查
      logger.info('🔍 Risk: 开始风控检查', {
        operation_id,
        from,
        to,
        amount,
        chainType: normalizedChainType
      });

      let decision: 'approve' | 'freeze' | 'reject' | 'manual_review' = 'approve'; // 默认批准
      const reasons: string[] = [];
      let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

      // 1. 检查目标地址黑名单
      logger.info('🔍 Risk: 检查目标地址黑名单', { to, chainType: normalizedChainType });
      const addressRisk = await this.addressRiskModel.checkAddress(to, normalizedChainType);

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
        logger.info('📝 Risk: 构建拒绝操作的签名载荷', {
          operation_id,
          chainType: normalizedChainType,
          from,
          to,
          amount,
          tokenAddress: tokenAddress || null,
          tokenType: tokenType || null,
          chainId,
          nonce,
          blockhash: blockhash || null,
          lastValidBlockHeight: lastValidBlockHeight || null,
          fee: fee || null,
          timestamp
        });

        const denySignaturePayload = this.buildSignaturePayload({
          operation_id,
          chainType: normalizedChainType,
          from,
          to,
          amount,
          tokenAddress,
          tokenType,
          chainId,
          nonce,
          blockhash,
          lastValidBlockHeight,
          fee,
          timestamp
        });

        logger.info('📋 Risk 拒绝操作的签名载荷:', denySignaturePayload);

        // 记录到数据库
        await this.riskAssessmentModel.create({
          operation_id,
          table_name: undefined,
          action: 'withdraw',
          operation_data: JSON.stringify(denySignaturePayload),
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

      // 通过风控检查，生成签名（复用 RiskAssessmentService 的 signer）
      logger.info('📝 Risk: 构建签名载荷（自动通过）', {
        operation_id,
        chainType: normalizedChainType,
        from,
        to,
        amount,
        tokenAddress: tokenAddress || null,
        tokenType: tokenType || null,
        chainId,
        nonce,
        blockhash: blockhash || null,
        lastValidBlockHeight: lastValidBlockHeight || null,
        fee: fee || null,
        timestamp
      });

      const signaturePayload = this.buildSignaturePayload({
        operation_id,
        chainType: normalizedChainType,
        from,
        to,
        amount,
        tokenAddress,
        tokenType,
        chainId,
        nonce,
        blockhash,
        lastValidBlockHeight,
        fee,
        timestamp
      });
      
      logger.info('📋 Risk 签名载荷（对象）:', signaturePayload);
      const signPayload = JSON.stringify(signaturePayload);
      logger.info('📋 Risk 签名载荷（JSON字符串）:', signPayload);

      logger.info('🔐 Risk: 开始生成签名');
      const riskSignature = this.riskService.signMessage(signPayload);
      logger.info('✅ Risk: 签名生成成功', {
        signature: riskSignature,
        signatureLength: riskSignature.length
      });

      // 记录到数据库
      // 计算签名过期时间（5分钟后）
      const expiresAt = new Date(timestamp + 5 * 60 * 1000).toISOString();

      await this.riskAssessmentModel.create({
        operation_id,
        table_name: undefined,  // 提现不对应具体数据库表
        action: 'withdraw',
        operation_data: JSON.stringify(
          this.buildSignaturePayload({
            operation_id,
            chainType: normalizedChainType,
            from,
            to,
            amount,
            tokenAddress,
            tokenType,
            chainId,
            nonce,
            blockhash,
            lastValidBlockHeight,
            fee,
            timestamp
          })
        ),
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

      logger.info('✅ Risk: 返回自动通过的响应', {
        operation_id,
        risk_signature: riskSignature,
        decision,
        timestamp,
        reasons: reasons.length > 0 ? reasons : undefined
      });

      return res.status(200).json({
        success: true,
        risk_signature: riskSignature,
        decision,
        timestamp,
        reasons
      });

    } catch (error) {
      logger.error('Withdraw risk assessment endpoint error', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : String(error),
        body: req.body
      });
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: error instanceof Error ? error.message : String(error)
        }
      });
    }
  };

  /**
   * 根据 operation_id 查询风控评估结果
   */
  getAssessmentByOperationId = async (req: Request, res: Response) => {
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

      const assessment = await this.riskAssessmentModel.findByOperationId(operation_id);

      if (!assessment) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Assessment not found',
            details: `No assessment found for operation_id: ${operation_id}`
          }
        });
      }

      return res.status(200).json({
        success: true,
        data: assessment
      });

    } catch (error) {
      logger.error('Get assessment by operation_id endpoint error', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : String(error),
        params: req.params
      });
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

  private buildSignaturePayload(params: {
    operation_id: string;
    chainType: 'evm' | 'btc' | 'solana';
    from: string;
    to: string;
    amount: string;
    tokenAddress?: string;
    tokenType?: string;
    chainId: number;
    nonce: number;
    blockhash?: string;
    lastValidBlockHeight?: string;
    fee?: string;
    timestamp: number;
  }): Record<string, any> {
    return {
      operation_id: params.operation_id,
      chainType: params.chainType,
      from: params.from,
      to: params.to,
      amount: params.amount,
      tokenAddress: params.tokenAddress ?? null,
      tokenType: params.tokenType ?? null,
      chainId: params.chainId,
      nonce: params.nonce,
      blockhash: params.blockhash ?? null,
      lastValidBlockHeight: params.lastValidBlockHeight ?? null,
      fee: params.fee ?? null,
      timestamp: params.timestamp
    };
  }
}
