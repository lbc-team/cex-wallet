import { Router, Request, Response } from 'express';
import { getDbGatewayClient } from '../services/dbGatewayClient';
import { WalletBusinessService } from '../services/walletBusinessService';
import { DatabaseReader } from '../db';

interface ManualReviewCallbackRequest {
  operation_id: string;
  decision: 'approved' | 'rejected';
  action: string;
  timestamp: number;
  risk_signature: string;
}

export function internalRoutes(dbService: DatabaseReader): Router {
  const router = Router();
  const dbGatewayClient = getDbGatewayClient();
  const walletBusinessService = new WalletBusinessService(dbService);

  /**
   * 接收风控服务的人工审核回调
   */
  router.post('/manual-review-callback', async (req: Request, res: Response) => {
    try {
      const { operation_id, decision, action, timestamp, risk_signature } = req.body as ManualReviewCallbackRequest;

      console.log('📞 收到人工审核回调', {
        operation_id,
        decision,
        action,
        timestamp,
        risk_signature: risk_signature ? `${risk_signature.substring(0, 16)}...` : 'missing'
      });

      // 1. 验证参数
      if (!operation_id || !decision || !action || !risk_signature) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: operation_id, decision, action, risk_signature'
        });
      }

      // 2. 根据 operation_id 查找提现记录
      const withdraw = await dbGatewayClient.findWithdrawByOperationId(operation_id);

      if (!withdraw) {
        console.error('❌ 未找到提现记录', { operation_id });
        return res.status(404).json({
          success: false,
          error: `Withdraw not found for operation_id: ${operation_id}`
        });
      }

      console.log('✅ 找到提现记录', {
        withdraw_id: withdraw.id,
        status: withdraw.status
      });

      // 3. 检查状态是否正确
      if (withdraw.status !== 'manual_reviewing') {
        console.warn('⚠️ 提现状态不正确', {
          withdraw_id: withdraw.id,
          current_status: withdraw.status,
          expected_status: 'manual_reviewing'
        });
        return res.status(400).json({
          success: false,
          error: `Withdraw status is ${withdraw.status}, expected manual_reviewing`
        });
      }

      // 4. 根据审核决策处理
      if (decision === 'approved') {
        // 审核通过，更新状态并继续签名
        console.log('✅ 审核通过，准备继续提现流程...');

        await dbGatewayClient.updateWithdrawStatus(withdraw.id, 'signing');

        // 异步处理签名和发送交易（不阻塞响应），传递风控签名
        walletBusinessService.continueWithdrawAfterReview(withdraw, risk_signature)
          .then(() => {
            console.log('✅ 提现处理成功', { withdraw_id: withdraw.id });
          })
          .catch((error) => {
            console.error('❌ 提现处理失败', {
              withdraw_id: withdraw.id,
              error: error instanceof Error ? error.message : String(error)
            });
          });

        return res.json({
          success: true,
          message: 'Withdraw approved, processing continues',
          withdraw_id: withdraw.id
        });

      } else if (decision === 'rejected') {
        // 审核拒绝，更新状态并退回余额
        console.log('❌ 审核拒绝，准备退回余额...');

        await dbGatewayClient.updateWithdrawStatus(withdraw.id, 'rejected', 'Manual review rejected');

        // 异步处理退款（不阻塞响应）
        walletBusinessService.refundWithdraw(withdraw)
          .then(() => {
            console.log('✅ 退款成功', { withdraw_id: withdraw.id });
          })
          .catch((error) => {
            console.error('❌ 退款失败', {
              withdraw_id: withdraw.id,
              error: error instanceof Error ? error.message : String(error)
            });
          });

        return res.json({
          success: true,
          message: 'Withdraw rejected, funds refunded',
          withdraw_id: withdraw.id
        });
      }

      return res.status(400).json({
        success: false,
        error: `Unknown decision: ${decision}`
      });

    } catch (error) {
      console.error('❌ 处理人工审核回调失败', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack
        } : String(error),
        body: req.body
      });

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  });

  return router;
}
