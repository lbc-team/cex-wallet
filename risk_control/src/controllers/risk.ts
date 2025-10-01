import { Request, Response } from 'express';
import { RiskAssessmentService } from '../services/risk-assessment';
import { RiskAssessmentRequest } from '../types';
import { logger } from '../utils/logger';

export class RiskController {
  constructor(private riskService: RiskAssessmentService) {}

  /**
   * 评估操作风险
   */
  assessRisk = async (req: Request, res: Response) => {
    try {
      const request = req.body as RiskAssessmentRequest;

      // 验证必需字段
      if (!request.operation_id || !request.event_type || !request.operation_type || !request.table || !request.action || !request.module) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing required fields',
            details: 'operation_id, event_type, operation_type, table, action, and module are required'
          }
        });
      }

      // 验证模块
      if (!['wallet', 'scan'].includes(request.module)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_MODULE',
            message: 'Invalid module',
            details: 'Module must be either wallet or scan'
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


}
