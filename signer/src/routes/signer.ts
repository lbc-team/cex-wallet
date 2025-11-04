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

      // 验证必需参数（根据链类型）
      const missingParams: string[] = [];
      if (!signRequest.address) missingParams.push('address');
      if (!signRequest.to) missingParams.push('to');
      if (!signRequest.amount) missingParams.push('amount');
      if (!signRequest.chainId) missingParams.push('chainId');
      if (!signRequest.chainType) missingParams.push('chainType');
      if (!signRequest.operation_id) missingParams.push('operation_id');
      if (!signRequest.timestamp) missingParams.push('timestamp');
      if (!signRequest.risk_signature) missingParams.push('risk_signature');
      if (!signRequest.wallet_signature) missingParams.push('wallet_signature');

      // EVM 需要 nonce，Solana 需要 blockhash
      if (signRequest.chainType === 'solana') {
        if (!signRequest.blockhash) missingParams.push('blockhash');
      } else if (signRequest.chainType === 'evm') {
        if (signRequest.nonce === undefined) missingParams.push('nonce');
      }

      if (missingParams.length > 0) {
        const response: ApiResponse = {
          success: false,
          error: `缺少必需参数: ${missingParams.join(', ')}`
        };
        return res.status(400).json(response);
      }

      // 验证地址格式（根据链类型）
      let isValidFromAddress = false;
      let isValidToAddress = false;

      if (signRequest.chainType === 'evm') {
        // EVM 地址: 0x + 40 个十六进制字符
        isValidFromAddress = /^0x[a-fA-F0-9]{40}$/.test(signRequest.address);
        isValidToAddress = /^0x[a-fA-F0-9]{40}$/.test(signRequest.to);
      } else if (signRequest.chainType === 'solana') {
        // Solana 地址: Base58 编码，32-44 个字符
        isValidFromAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(signRequest.address);
        isValidToAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(signRequest.to);
      } else if (signRequest.chainType === 'btc') {
        // BTC 地址
        isValidFromAddress = /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,89}$/.test(signRequest.address);
        isValidToAddress = /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,89}$/.test(signRequest.to);
      }

      if (!isValidFromAddress) {
        const response: ApiResponse = {
          success: false,
          error: `无效的${signRequest.chainType.toUpperCase()}发送方地址格式`
        };
        return res.status(400).json(response);
      }

      if (!isValidToAddress) {
        const response: ApiResponse = {
          success: false,
          error: `无效的${signRequest.chainType.toUpperCase()}接收方地址格式`
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

      // 验证代币地址格式（根据链类型）
      if (signRequest.chainType === 'evm' && signRequest.tokenAddress) {
        if (!signRequest.tokenAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
          const response: ApiResponse = {
            success: false,
            error: '无效的ERC20代币合约地址格式'
          };
          return res.status(400).json(response);
        }
      } else if (signRequest.chainType === 'solana' && signRequest.tokenAddress) {
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(signRequest.tokenAddress)) {
          const response: ApiResponse = {
            success: false,
            error: '无效的SPL代币Mint地址格式'
          };
          return res.status(400).json(response);
        }
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
