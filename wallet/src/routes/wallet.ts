import { Router, Request, Response } from 'express';
import { DatabaseService } from '../db';
import { WalletBusinessService } from '../services/walletBusinessService';

// API响应接口
interface ApiResponse<T = any> {
  message?: string;
  error?: string;
  data?: T;
}

export function walletRoutes(dbService: DatabaseService): Router {
  const router = Router();
  const walletBusinessService = new WalletBusinessService(dbService);

  // 获取用户的钱包地址
  router.get('/user/:id/address', async (req: Request<{ id: string }, ApiResponse>, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    const chain_type = req.query.chain_type as 'evm' | 'btc' | 'solana';
    
    // 参数验证
    if (isNaN(userId)) {
      const errorResponse: ApiResponse = { error: '无效的用户ID' };
      res.status(400).json(errorResponse);
      return;
    }

    if (!chain_type) {
      const errorResponse: ApiResponse = { error: '链类型是必需的' };
      res.status(400).json(errorResponse);
      return;
    }

    if (!['evm', 'btc', 'solana'].includes(chain_type)) {
      const errorResponse: ApiResponse = { error: '不支持的链类型，支持的类型: evm, btc, solana' };
      res.status(400).json(errorResponse);
      return;
    }

    // 调用业务逻辑服务
    const result = await walletBusinessService.getUserWallet(userId, chain_type);
    
    if (result.success) {
      const successResponse: ApiResponse = { 
        message: '获取用户钱包成功',
        data: result.data
      };
      res.json(successResponse);
    } else {
      const errorResponse: ApiResponse = { error: result.error || '未知错误' };
      
      // 根据错误类型设置不同的状态码
      if (result.error?.includes('Signer 模块不可用')) {
        res.status(503).json(errorResponse);
      } else if (result.error?.includes('生成的钱包地址已被使用')) {
        res.status(409).json(errorResponse);
      } else {
        res.status(500).json(errorResponse);
      }
    }
  });


  // 获取钱包余额
  router.get('/wallet/:id/balance', async (req: Request<{ id: string }>, res: Response) => {
    const walletId = parseInt(req.params.id, 10);
    
    if (isNaN(walletId)) {
      const errorResponse: ApiResponse = { error: '无效的钱包ID' };
      res.status(400).json(errorResponse);
      return;
    }

    const result = await walletBusinessService.getWalletBalance(walletId);
    
    if (result.success) {
      const response: ApiResponse = { data: result.data };
      res.json(response);
    } else {
      const errorResponse: ApiResponse = { error: result.error || '未知错误' };
      res.status(500).json(errorResponse);
    }
  });




  return router;
}
