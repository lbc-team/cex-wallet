import { RiskAssessmentModel, RiskManualReviewModel } from '../db/models';
import { riskControlDB } from '../db/connection';
import { logger } from '../utils/logger';

export interface ManualReviewRequest {
  operation_id: string;
  approver_user_id: number;
  approver_username?: string;
  approved: boolean;
  modified_data?: any;
  comment?: string;
  ip_address?: string;
  user_agent?: string;
}

export interface ManualReviewResponse {
  success: boolean;
  message: string;
  operation_id: string;
  approval_status: 'approved' | 'rejected';
  error?: string;
}

/**
 * 人工审核服务
 */
export class ManualReviewService {
  private assessmentModel: RiskAssessmentModel;
  private reviewModel: RiskManualReviewModel;

  constructor() {
    this.assessmentModel = new RiskAssessmentModel(riskControlDB);
    this.reviewModel = new RiskManualReviewModel(riskControlDB);
  }

  /**
   * 提交人工审核结果
   */
  async submitReview(request: ManualReviewRequest): Promise<ManualReviewResponse> {
    try {
      // 1. 查找评估记录
      const assessment = await this.assessmentModel.findByOperationId(request.operation_id);
      if (!assessment) {
        return {
          success: false,
          message: 'Assessment record not found',
          operation_id: request.operation_id,
          approval_status: 'rejected',
          error: 'ASSESSMENT_NOT_FOUND'
        };
      }

      // 2. 检查是否已经审核过
      if (assessment.approval_status !== 'pending') {
        return {
          success: false,
          message: `This operation has already been ${assessment.approval_status}`,
          operation_id: request.operation_id,
          approval_status: assessment.approval_status as 'approved' | 'rejected',
          error: 'ALREADY_REVIEWED'
        };
      }

      // 3. 检查是否需要人工审核
      if (assessment.decision !== 'manual_review') {
        return {
          success: false,
          message: 'This operation does not require manual review',
          operation_id: request.operation_id,
          approval_status: 'rejected',
          error: 'NO_REVIEW_REQUIRED'
        };
      }

      const approvalStatus = request.approved ? 'approved' : 'rejected';

      // 4. 使用事务保证一致性
      await riskControlDB.transaction(async () => {
        // 4.1 创建审核记录
        await this.reviewModel.create({
          assessment_id: assessment.id!,
          operation_id: request.operation_id,
          approver_user_id: request.approver_user_id,
          approver_username: request.approver_username,
          approved: request.approved ? 1 : 0,
          modified_data: request.modified_data ? JSON.stringify(request.modified_data) : undefined,
          comment: request.comment,
          ip_address: request.ip_address,
          user_agent: request.user_agent
        });

        // 4.2 更新评估记录的审批状态
        await this.assessmentModel.updateApprovalStatus(request.operation_id, approvalStatus);
      });

      logger.info('Manual review submitted', {
        operation_id: request.operation_id,
        approved: request.approved,
        approver_user_id: request.approver_user_id
      });

      return {
        success: true,
        message: `Operation ${approvalStatus} successfully`,
        operation_id: request.operation_id,
        approval_status: approvalStatus
      };

    } catch (error) {
      logger.error('Failed to submit manual review', { error, request });
      return {
        success: false,
        message: 'Failed to submit review',
        operation_id: request.operation_id,
        approval_status: 'rejected',
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR'
      };
    }
  }

  /**
   * 获取待审核列表
   */
  async getPendingReviews(limit: number = 50) {
    try {
      const pendingReviews = await this.assessmentModel.findPendingReviews(limit);
      return {
        success: true,
        data: pendingReviews.map(review => ({
          id: review.id,
          operation_id: review.operation_id,
          table_name: review.table_name,
          action: review.action,
          user_id: review.user_id,
          operation_data: JSON.parse(review.operation_data),
          suggest_operation_data: review.suggest_operation_data
            ? JSON.parse(review.suggest_operation_data)
            : null,
          suggest_reason: review.suggest_reason,
          risk_level: review.risk_level,
          reasons: JSON.parse(review.reasons || '[]'),
          created_at: review.created_at
        }))
      };
    } catch (error) {
      logger.error('Failed to get pending reviews', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR'
      };
    }
  }

  /**
   * 获取审核历史
   */
  async getReviewHistory(operationId: string) {
    try {
      const reviews = await this.reviewModel.findByOperationId(operationId);
      return {
        success: true,
        data: reviews.map(review => ({
          id: review.id,
          assessment_id: review.assessment_id,
          operation_id: review.operation_id,
          approver_user_id: review.approver_user_id,
          approver_username: review.approver_username,
          approved: review.approved === 1,
          modified_data: review.modified_data ? JSON.parse(review.modified_data) : null,
          comment: review.comment,
          ip_address: review.ip_address,
          user_agent: review.user_agent,
          created_at: review.created_at
        }))
      };
    } catch (error) {
      logger.error('Failed to get review history', { error, operationId });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR'
      };
    }
  }
}
