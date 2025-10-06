import { Request, Response } from 'express';
import { RiskAssessmentService } from '../services/risk-assessment';
import { ManualReviewService } from '../services/manual-review';
import { RiskAssessmentRequest } from '../types';
import { logger } from '../utils/logger';

export class RiskController {
  private manualReviewService: ManualReviewService;

  constructor(private riskService: RiskAssessmentService) {
    this.manualReviewService = new ManualReviewService();
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
}
