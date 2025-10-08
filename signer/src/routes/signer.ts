import { Router, Request, Response } from 'express';
import { AddressService } from '../services/addressService';
import { SignTransactionRequest } from '../types/wallet';

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

  // 签名交易
  router.post('/sign-transaction', async (req: Request, res: Response) => {
    console.log('收到签名交易请求:', req.body);
    try {
      const signRequest: SignTransactionRequest = req.body;

      // 验证必需参数
      if (!signRequest.address || !signRequest.to || !signRequest.amount ||
          signRequest.nonce === undefined || !signRequest.chainId || !signRequest.chainType ||
          !signRequest.operation_id || !signRequest.timestamp ||
          !signRequest.risk_signature || !signRequest.wallet_signature) {
        const response: ApiResponse = {
          success: false,
          error: '缺少必需参数: address, to, amount, nonce, chainId, chainType, operation_id, timestamp, risk_signature, wallet_signature'
        };
        return res.status(400).json(response);
      }

      // 验证地址格式
      if (!signRequest.address.match(/^0x[a-fA-F0-9]{40}$/)) {
        const response: ApiResponse = {
          success: false,
          error: '无效的发送方地址格式'
        };
        return res.status(400).json(response);
      }

      if (!signRequest.to.match(/^0x[a-fA-F0-9]{40}$/)) {
        const response: ApiResponse = {
          success: false,
          error: '无效的接收方地址格式'
        };
        return res.status(400).json(response);
      }

      // 验证金额格式（应该是数字字符串）
      try {
        BigInt(signRequest.amount);
      } catch {
        const response: ApiResponse = {
          success: false,
          error: '无效的金额格式，应该是数字字符串'
        };
        return res.status(400).json(response);
      }

      // 如果有代币地址，验证格式
      if (signRequest.tokenAddress && !signRequest.tokenAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        const response: ApiResponse = {
          success: false,
          error: '无效的代币合约地址格式'
        };
        return res.status(400).json(response);
      }

      // 验证 EIP-1559 gas 参数格式
      if (signRequest.maxFeePerGas) {
        try {
          BigInt(signRequest.maxFeePerGas);
        } catch {
          const response: ApiResponse = {
            success: false,
            error: '无效的 maxFeePerGas 格式，应该是数字字符串'
          };
          return res.status(400).json(response);
        }
      }

      if (signRequest.maxPriorityFeePerGas) {
        try {
          BigInt(signRequest.maxPriorityFeePerGas);
        } catch {
          const response: ApiResponse = {
            success: false,
            error: '无效的 maxPriorityFeePerGas 格式，应该是数字字符串'
          };
          return res.status(400).json(response);
        }
      }

      // 验证 Legacy gasPrice 参数格式
      if (signRequest.gasPrice) {
        try {
          BigInt(signRequest.gasPrice);
        } catch {
          const response: ApiResponse = {
            success: false,
            error: '无效的 gasPrice 格式，应该是数字字符串'
          };
          return res.status(400).json(response);
        }
      }

      // 验证交易类型
      if (signRequest.type !== undefined && signRequest.type !== 0 && signRequest.type !== 2) {
        const response: ApiResponse = {
          success: false,
          error: '无效的交易类型，支持的类型: 0 (Legacy), 2 (EIP-1559)'
        };
        return res.status(400).json(response);
      }

      // 验证链类型
      if (!['evm', 'btc', 'solana'].includes(signRequest.chainType)) {
        const response: ApiResponse = {
          success: false,
          error: '不支持的链类型，支持的类型: evm, btc, solana'
        };
        return res.status(400).json(response);
      }

      // 验证链ID
      if (typeof signRequest.chainId !== 'number' || signRequest.chainId <= 0) {
        const response: ApiResponse = {
          success: false,
          error: '无效的链ID格式'
        };
        return res.status(400).json(response);
      }

      // 调用签名服务
      const result = await addressService.signTransaction(signRequest);

      if (result.success) {
        const response: ApiResponse = {
          success: true,
          message: '交易签名成功',
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
