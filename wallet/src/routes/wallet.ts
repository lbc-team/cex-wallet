import { Router, Request, Response } from 'express';
import { DatabaseService } from '../db';
import { CreateWalletRequest } from '../db';

// API响应接口
interface ApiResponse<T = any> {
  message?: string;
  error?: string;
  data?: T;
}

export function createWalletRoutes(dbService: DatabaseService): Router {
  const router = Router();

  // 获取所有钱包
  router.get('/', async (req: Request, res: Response) => {
    try {
      const wallets = await dbService.wallets.findAllSafe();
      const response: ApiResponse<typeof wallets> = { data: wallets };
      res.json(response);
    } catch (error) {
      const errorResponse: ApiResponse = { 
        error: error instanceof Error ? error.message : '获取钱包列表失败' 
      };
      res.status(500).json(errorResponse);
    }
  });

  // 创建新钱包
  router.post('/', async (req: Request<{}, ApiResponse, CreateWalletRequest>, res: Response) => {
    try {
      const { address, device, path, chain_type } = req.body;
      
      if (!address || !chain_type) {
        const errorResponse: ApiResponse = { error: '地址和链类型是必需的' };
        res.status(400).json(errorResponse);
        return;
      }

      // 检查地址是否已存在
      const existingWallet = await dbService.wallets.findByAddress(address);
      if (existingWallet) {
        const errorResponse: ApiResponse = { error: '钱包地址已存在' };
        res.status(409).json(errorResponse);
        return;
      }

      const walletData: CreateWalletRequest = { address, chain_type };
      if (device) walletData.device = device;
      if (path) walletData.path = path;
      
      const wallet = await dbService.wallets.create(walletData);
      
      const successResponse: ApiResponse = { 
        message: '钱包创建成功',
        data: wallet
      };
      res.json(successResponse);
    } catch (error) {
      const errorResponse: ApiResponse = { 
        error: error instanceof Error ? error.message : '创建钱包失败' 
      };
      res.status(500).json(errorResponse);
    }
  });

  // 获取钱包详情
  router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      
      if (isNaN(walletId)) {
        const errorResponse: ApiResponse = { error: '无效的钱包ID' };
        res.status(400).json(errorResponse);
        return;
      }

      const wallet = await dbService.wallets.findById(walletId);
      if (!wallet) {
        const errorResponse: ApiResponse = { error: '钱包不存在' };
        res.status(404).json(errorResponse);
        return;
      }

      const response: ApiResponse<typeof wallet> = { data: wallet };
      res.json(response);
    } catch (error) {
      const errorResponse: ApiResponse = { 
        error: error instanceof Error ? error.message : '获取钱包详情失败' 
      };
      res.status(500).json(errorResponse);
    }
  });

  // 获取钱包余额
  router.get('/:id/balance', async (req: Request<{ id: string }>, res: Response) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      
      if (isNaN(walletId)) {
        const errorResponse: ApiResponse = { error: '无效的钱包ID' };
        res.status(400).json(errorResponse);
        return;
      }

      const balance = await dbService.wallets.getBalance(walletId);
      const response: ApiResponse<{ balance: number }> = { data: { balance } };
      res.json(response);
    } catch (error) {
      const errorResponse: ApiResponse = { 
        error: error instanceof Error ? error.message : '获取钱包余额失败' 
      };
      res.status(500).json(errorResponse);
    }
  });

  // 更新钱包余额
  router.put('/:id/balance', async (req: Request<{ id: string }, ApiResponse, { balance: number }>, res: Response) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      const { balance } = req.body;
      
      if (isNaN(walletId)) {
        const errorResponse: ApiResponse = { error: '无效的钱包ID' };
        res.status(400).json(errorResponse);
        return;
      }

      if (typeof balance !== 'number' || balance < 0) {
        const errorResponse: ApiResponse = { error: '无效的余额值' };
        res.status(400).json(errorResponse);
        return;
      }

      await dbService.wallets.updateBalance(walletId, balance);
      const response: ApiResponse = { message: '余额更新成功' };
      res.json(response);
    } catch (error) {
      const errorResponse: ApiResponse = { 
        error: error instanceof Error ? error.message : '更新钱包余额失败' 
      };
      res.status(500).json(errorResponse);
    }
  });

  // 获取钱包统计信息
  router.get('/:id/stats', async (req: Request<{ id: string }>, res: Response) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      
      if (isNaN(walletId)) {
        const errorResponse: ApiResponse = { error: '无效的钱包ID' };
        res.status(400).json(errorResponse);
        return;
      }

      const walletStats = await dbService.wallets.getStats();
      const response: ApiResponse = { 
        data: {
          wallet: walletStats
        }
      };
      res.json(response);
    } catch (error) {
      const errorResponse: ApiResponse = { 
        error: error instanceof Error ? error.message : '获取统计信息失败' 
      };
      res.status(500).json(errorResponse);
    }
  });

  return router;
}
