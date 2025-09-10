import { Router, Request, Response } from 'express';
import { AddressService } from '../services/addressService';

// API响应接口
interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export function createSignerRoutes(addressService: AddressService): Router {
  const router = Router();

  // 创建新钱包
  router.post('/create', async (req: Request, res: Response) => {
    console.log('收到创建钱包请求:', req.body);
    try {
      const { chainType } = req.body;

      // 验证必需参数
      if (!chainType) {
        const response: ApiResponse = {
          success: false,
          error: '缺少必需参数: chainType'
        };
        return res.status(400).json(response);
      }

      // 验证链类型
      if (!['evm', 'btc', 'solana'].includes(chainType)) {
        const response: ApiResponse = {
          success: false,
          error: '不支持的链类型，支持的类型: evm, btc, solana'
        };
        return res.status(400).json(response);
      }

      // 创建钱包
      const result = await addressService.createNewWallet(chainType);

      if (result.success) {
        const response: ApiResponse = {
          success: true,
          message: '钱包创建成功',
          data: result.data
        };
        return res.json(response);
      } else {
        const response: ApiResponse = {
          success: false,
          error: result.error
        };
        return res.status(400).json(response);
      }

    } catch (error) {
      const response: ApiResponse = {
        success: false,
        error: `服务器错误: ${error instanceof Error ? error.message : '未知错误'}`
      };
      return res.status(500).json(response);
    }
  });


  return router;
}
