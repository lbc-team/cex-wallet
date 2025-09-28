import { Router, Request, Response } from 'express';
import { DatabaseService } from '../db';
import { WalletBusinessService } from '../services/walletBusinessService';
import { chainConfigManager } from '../utils/chains';

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


  // 获取用户余额总和（所有链的总和）
  router.get('/user/:id/balance/total', async (req: Request<{ id: string }>, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    
    if (isNaN(userId)) {
      const errorResponse: ApiResponse = { error: '无效的用户ID' };
      res.status(400).json(errorResponse);
      return;
    }

    const result = await walletBusinessService.getUserTotalBalance(userId);
    
    if (result.success) {
      const response: ApiResponse = { 
        message: '获取用户余额总和成功',
        data: result.data 
      };
      res.json(response);
    } else {
      const errorResponse: ApiResponse = { error: result.error || '未知错误' };
      res.status(500).json(errorResponse);
    }
  });

  // 获取用户充值中的余额
  router.get('/user/:id/balance/pending', async (req: Request<{ id: string }>, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    
    if (isNaN(userId)) {
      const errorResponse: ApiResponse = { error: '无效的用户ID' };
      res.status(400).json(errorResponse);
      return;
    }

    const result = await walletBusinessService.getUserPendingDeposits(userId);
    
    if (result.success) {
      const response: ApiResponse = { 
        message: '获取充值中余额成功',
        data: result.data 
      };
      res.json(response);
    } else {
      const errorResponse: ApiResponse = { error: result.error || '未知错误' };
      res.status(500).json(errorResponse);
    }
  });

  // 获取用户指定代币的余额详情
  router.get('/user/:id/balance/token/:symbol', async (req: Request<{ id: string; symbol: string }>, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    const tokenSymbol = req.params.symbol;
    
    if (isNaN(userId)) {
      const errorResponse: ApiResponse = { error: '无效的用户ID' };
      res.status(400).json(errorResponse);
      return;
    }

    if (!tokenSymbol || tokenSymbol.trim() === '') {
      const errorResponse: ApiResponse = { error: '代币符号不能为空' };
      res.status(400).json(errorResponse);
      return;
    }

    const result = await walletBusinessService.getUserTokenBalance(userId, tokenSymbol.toUpperCase());
    
    if (result.success) {
      const response: ApiResponse = { 
        message: `获取${tokenSymbol.toUpperCase()}余额详情成功`,
        data: result.data 
      };
      res.json(response);
    } else {
      if (result.error?.includes('用户没有')) {
        const errorResponse: ApiResponse = { error: result.error };
        res.status(404).json(errorResponse);
      } else {
        const errorResponse: ApiResponse = { error: result.error || '未知错误' };
        res.status(500).json(errorResponse);
      }
    }
  });

  // 用户提现
  router.post('/user/withdraw', async (req: Request, res: Response) => {
    const { 
      userId, 
      to, 
      amount, 
      tokenSymbol,
      chainId,
      chainType
    } = req.body;
    
    // 参数验证
    if (!userId || !to || !amount || !tokenSymbol || !chainId || !chainType) {
      const errorResponse: ApiResponse = { error: '缺少必需参数: userId, to, amount, tokenSymbol, chainId, chainType' };
      res.status(400).json(errorResponse);
      return;
    }

    // 验证用户ID格式
    const userIdNum = parseInt(userId, 10);
    if (isNaN(userIdNum)) {
      const errorResponse: ApiResponse = { error: '无效的用户ID' };
      res.status(400).json(errorResponse);
      return;
    }

    // 验证地址格式
    if (!to.match(/^0x[a-fA-F0-9]{40}$/)) {
      const errorResponse: ApiResponse = { error: '无效的目标地址格式' };
      res.status(400).json(errorResponse);
      return;
    }

    // 验证金额格式
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      const errorResponse: ApiResponse = { error: '无效的提现金额' };
      res.status(400).json(errorResponse);
      return;
    }

    // 验证链类型
    if (!['evm', 'btc', 'solana'].includes(chainType)) {
      const errorResponse: ApiResponse = { error: '不支持的链类型，支持的类型: evm, btc, solana' };
      res.status(400).json(errorResponse);
      return;
    }

    // 验证链ID格式
    const chainIdNum = parseInt(chainId, 10);
    if (isNaN(chainIdNum) || chainIdNum <= 0) {
      const errorResponse: ApiResponse = { error: '无效的链ID格式' };
      res.status(400).json(errorResponse);
      return;
    }

    // 调用业务逻辑服务（Gas 费用将自动估算）
    const result = await walletBusinessService.withdrawFunds({
      userId: userIdNum,
      to: to,
      amount: amount,
      tokenSymbol: tokenSymbol.toUpperCase(),
      chainId: chainIdNum,
      chainType: chainType as 'evm' | 'btc' | 'solana'
    });
    
    if (result.success) {
      const successResponse: ApiResponse = { 
        message: '提现签名成功',
        data: result.data
      };
      res.json(successResponse);
    } else {
      const errorResponse: ApiResponse = { error: result.error || '提现失败' };
      
      // 根据错误类型设置不同的状态码
      if (result.error?.includes('余额不足')) {
        res.status(400).json(errorResponse);
      } else if (result.error?.includes('钱包不存在')) {
        res.status(404).json(errorResponse);
      } else if (result.error?.includes('Signer 模块不可用')) {
        res.status(503).json(errorResponse);
      } else if (result.error?.includes('不支持的代币')) {
        res.status(400).json(errorResponse);
      } else {
        res.status(500).json(errorResponse);
      }
    }
  });

  // 获取用户提现记录
  router.get('/user/:id/withdraws', async (req: Request<{ id: string }>, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    
    if (isNaN(userId)) {
      const errorResponse: ApiResponse = { error: '无效的用户ID' };
      res.status(400).json(errorResponse);
      return;
    }

    try {
      const withdraws = await dbService.getConnection().getUserWithdraws(userId, status);
      
      // 分页处理
      const total = withdraws.length;
      const paginatedWithdraws = withdraws.slice(offset, offset + limit);
      
      const response: ApiResponse = {
        message: '获取用户提现记录成功',
        data: {
          withdraws: paginatedWithdraws,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total
          }
        }
      };
      
      res.json(response);
    } catch (error) {
      const errorResponse: ApiResponse = { 
        error: error instanceof Error ? error.message : '获取提现记录失败' 
      };
      res.status(500).json(errorResponse);
    }
  });

  // 获取特定提现记录详情
  router.get('/withdraws/:withdrawId', async (req: Request<{ withdrawId: string }>, res: Response) => {
    const withdrawId = parseInt(req.params.withdrawId, 10);
    
    if (isNaN(withdrawId)) {
      const errorResponse: ApiResponse = { error: '无效的提现ID' };
      res.status(400).json(errorResponse);
      return;
    }

    try {
      const withdraw = await dbService.getConnection().getWithdrawById(withdrawId);
      
      if (!withdraw) {
        const errorResponse: ApiResponse = { error: '提现记录不存在' };
        res.status(404).json(errorResponse);
        return;
      }

      // 获取关联的 credit 记录
      const credits = await dbService.getConnection().getCreditsByWithdrawId(withdrawId);
      
      const response: ApiResponse = {
        message: '获取提现记录详情成功',
        data: {
          withdraw,
          credits
        }
      };
      
      res.json(response);
    } catch (error) {
      const errorResponse: ApiResponse = { 
        error: error instanceof Error ? error.message : '获取提现记录详情失败' 
      };
      res.status(500).json(errorResponse);
    }
  });

  // 获取待处理的提现 
  router.get('/withdraws/pending', async (req: Request, res: Response) => {
    try {
      const pendingWithdraws = await dbService.getConnection().getPendingWithdraws();
      
      const response: ApiResponse = {
        message: '获取待处理提现成功',
        data: {
          withdraws: pendingWithdraws,
          count: pendingWithdraws.length
        }
      };
      
      res.json(response);
    } catch (error) {
      const errorResponse: ApiResponse = { 
        error: error instanceof Error ? error.message : '获取待处理提现失败' 
      };
      res.status(500).json(errorResponse);
    }
  });

  // 更新提现状态 
  router.put('/withdraws/:withdrawId/status', async (req: Request<{ withdrawId: string }>, res: Response) => {
    const withdrawId = parseInt(req.params.withdrawId, 10);
    const { status, txHash, gasUsed, errorMessage } = req.body;
    
    if (isNaN(withdrawId)) {
      const errorResponse: ApiResponse = { error: '无效的提现ID' };
      res.status(400).json(errorResponse);
      return;
    }

    if (!status) {
      const errorResponse: ApiResponse = { error: '状态是必需的' };
      res.status(400).json(errorResponse);
      return;
    }

    // 验证状态值
    const validStatuses = ['user_withdraw_request', 'signing', 'pending', 'processing', 'confirmed', 'failed'];
    if (!validStatuses.includes(status)) {
      const errorResponse: ApiResponse = { 
        error: `无效的状态值，支持的状态: ${validStatuses.join(', ')}` 
      };
      res.status(400).json(errorResponse);
      return;
    }

    try {
      await dbService.getConnection().updateWithdrawStatus(withdrawId, status, {
        txHash,
        gasUsed,
        errorMessage
      });
      
      const response: ApiResponse = {
        message: '更新提现状态成功',
        data: {
          withdrawId,
          status
        }
      };
      
      res.json(response);
    } catch (error) {
      const errorResponse: ApiResponse = { 
        error: error instanceof Error ? error.message : '更新提现状态失败' 
      };
      res.status(500).json(errorResponse);
    }
  });

  // 获取网络状态和 Gas 信息
  router.get('/network/status', async (req: Request, res: Response) => {
    try {
      const networkInfo = await chainConfigManager.getNetworkInfo(1); // 默认使用主网
      
      const response: ApiResponse = {
        message: '获取网络状态成功',
        data: {
          chainId: networkInfo.chainId,
          blockNumber: networkInfo.blockNumber.toString(),
          baseFeePerGas: networkInfo.baseFeePerGas.toString(),
          gasPrice: networkInfo.gasPrice.toString(),
          networkCongestion: networkInfo.networkCongestion,
          // 转换为 Gwei 显示
          baseFeeGwei: (Number(networkInfo.baseFeePerGas) / 1e9).toFixed(2),
          gasPriceGwei: (Number(networkInfo.gasPrice) / 1e9).toFixed(2)
        }
      };
      
      res.json(response);
    } catch (error) {
      const errorResponse: ApiResponse = { 
        error: error instanceof Error ? error.message : '获取网络状态失败' 
      };
      res.status(500).json(errorResponse);
    }
  });


  return router;
}
