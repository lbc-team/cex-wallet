#!/usr/bin/env ts-node

/**
 * 模拟人工审核通过脚本
 * 自动获取最新的待审核记录并批准
 * 使用方法: npx ts-node src/scripts/mockApproveReview.ts
 */

import axios from 'axios';

// 配置参数
const CONFIG = {
  RISK_CONTROL_URL: 'http://localhost:3004',
  APPROVER_USER_ID: 1,
  APPROVER_USERNAME: 'admin'
} as const;

interface PendingReview {
  id: number;
  operation_id: string;
  table_name: string;
  action: string;
  user_id: number;
  operation_data: any;
  suggest_operation_data?: any;
  suggest_reason?: string;
  risk_level: string;
  reasons: string[];
  created_at: string;
}

interface PendingReviewsResponse {
  success: boolean;
  data?: PendingReview[];
  error?: string;
}

interface ApprovalRequest {
  operation_id: string;
  approver_user_id: number;
  approver_username?: string;
  approved: boolean;
  comment?: string;
}

interface ApprovalResponse {
  success: boolean;
  message: string;
  operation_id: string;
  approval_status: string;
  error?: string;
}

class MockReviewApprover {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * 获取待审核列表
   */
  async getPendingReviews(): Promise<PendingReviewsResponse> {
    try {
      console.log('📋 获取待审核列表...');

      const response = await axios.get<PendingReviewsResponse>(
        `${this.baseUrl}/api/pending-reviews`,
        {
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          return {
            success: false,
            error: `服务器错误: ${error.response.status} - ${error.response.data?.error || error.message}`
          };
        } else if (error.request) {
          return {
            success: false,
            error: '网络错误: 无法连接到风控服务'
          };
        }
      }

      return {
        success: false,
        error: `请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 提交审核
   */
  async submitApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    try {
      console.log('✅ 提交审核通过...');

      const response = await axios.post<ApprovalResponse>(
        `${this.baseUrl}/api/manual-review`,
        request,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          return {
            success: false,
            message: 'Approval failed',
            operation_id: request.operation_id,
            approval_status: 'rejected',
            error: `服务器错误: ${error.response.status} - ${JSON.stringify(error.response.data)}`
          };
        } else if (error.request) {
          return {
            success: false,
            message: 'Network error',
            operation_id: request.operation_id,
            approval_status: 'rejected',
            error: '网络错误: 无法连接到风控服务'
          };
        }
      }

      return {
        success: false,
        message: 'Unknown error',
        operation_id: request.operation_id,
        approval_status: 'rejected',
        error: `请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 显示待审核信息
   */
  displayPendingReview(review: PendingReview): void {
    console.log('\n📝 待审核记录详情:');
    console.log('  Operation ID:', review.operation_id);
    console.log('  Table:', review.table_name);
    console.log('  Action:', review.action);
    console.log('  User ID:', review.user_id);
    console.log('  Risk Level:', review.risk_level);
    console.log('  Reasons:', review.reasons.join(', '));
    console.log('  Created At:', review.created_at);

    if (review.operation_data) {
      console.log('  Operation Data:', JSON.stringify(review.operation_data, null, 2));
    }

    if (review.suggest_operation_data) {
      console.log('  Suggested Data:', JSON.stringify(review.suggest_operation_data, null, 2));
      console.log('  Suggest Reason:', review.suggest_reason);
    }
  }

  /**
   * 运行审核流程
   */
  async runApproval(): Promise<void> {
    console.log('=== 模拟人工审核通过脚本 ===\n');

    // 1. 获取待审核列表
    const pendingResponse = await this.getPendingReviews();

    if (!pendingResponse.success) {
      console.error('❌ 获取待审核列表失败:', pendingResponse.error);
      return;
    }

    if (!pendingResponse.data || pendingResponse.data.length === 0) {
      console.log('ℹ️  没有待审核的记录');
      return;
    }

    // 2. 获取最新的待审核记录（第一个）
    const latestReview = pendingResponse.data[0];
    if (!latestReview) {
      console.log('❌ 待审核列表为空');
      return;
    }

    console.log(`✅ 找到 ${pendingResponse.data.length} 条待审核记录，处理最新的一条:`);
    this.displayPendingReview(latestReview);

    // 3. 提交审核通过
    console.log('\n🔄 准备提交审核通过...');
    const approvalRequest: ApprovalRequest = {
      operation_id: latestReview.operation_id,
      approver_user_id: CONFIG.APPROVER_USER_ID,
      approver_username: CONFIG.APPROVER_USERNAME,
      approved: true,
      comment: 'Auto-approved by mock script for testing'
    };

    const approvalResponse = await this.submitApproval(approvalRequest);

    // 4. 显示结果
    console.log('\n📋 审核结果:');
    console.log(JSON.stringify(approvalResponse, null, 2));

    if (approvalResponse.success) {
      console.log('\n✅ 审核通过成功！');
      console.log('📌 Operation ID:', approvalResponse.operation_id);
      console.log('📊 Approval Status:', approvalResponse.approval_status);
      console.log('\n💡 提示: Wallet 服务将自动收到回调并继续处理提现');
    } else {
      console.log('\n❌ 审核失败:', approvalResponse.error);
    }

    console.log('\n=== 脚本执行完成 ===');
  }
}

// 主函数
async function main(): Promise<void> {
  const approver = new MockReviewApprover(CONFIG.RISK_CONTROL_URL);
  await approver.runApproval();
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch((error) => {
    console.error('脚本执行失败:', error);
    process.exit(1);
  });
}

export { MockReviewApprover, CONFIG };
