import express, { Request, Response } from 'express';
import { WalletService } from './services/walletService';
import { CreateWalletRequest } from './types/wallet';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 初始化钱包服务
const walletService = new WalletService();

// API响应接口
interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

// 根路由
app.get('/', (req: Request, res: Response) => {
  const response: ApiResponse = {
    success: true,
    message: 'CEX钱包系统 - 签名器模块',
    data: {
      version: '1.0.0',
      status: 'running',
      endpoints: {
        'POST /api/wallets/create': '创建新钱包',
        'POST /api/wallets/create-from-mnemonic': '从助记词创建钱包',
        'POST /api/wallets/create-from-private-key': '从私钥创建钱包',
        'GET /api/wallets/validate-address': '验证钱包地址',
        'GET /api/mnemonic/generate': '生成助记词'
      }
    }
  };
  res.json(response);
});

// 健康检查
app.get('/health', (req: Request, res: Response) => {
  const response: ApiResponse = {
    success: true,
    message: '签名器服务健康',
    data: {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }
  };
  res.json(response);
});

// 创建新钱包
app.post('/api/wallets/create', (req: Request, res: Response) => {
  try {
    const { device, path, chainType } = req.body as CreateWalletRequest;

    // 验证必需参数
    if (!device || !chainType) {
      const response: ApiResponse = {
        success: false,
        error: '缺少必需参数: device, chainType'
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
    const result = walletService.createNewWallet({ device, path, chainType });

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

// 从助记词创建钱包
app.post('/api/wallets/create-from-mnemonic', (req: Request, res: Response) => {
  try {
    const { device, path, chainType, mnemonic } = req.body as CreateWalletRequest & { mnemonic: string };

    // 验证必需参数
    if (!device || !chainType || !mnemonic) {
      const response: ApiResponse = {
        success: false,
        error: '缺少必需参数: device, chainType, mnemonic'
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
    const result = walletService.createWalletFromMnemonic({ device, path, chainType, mnemonic });

    if (result.success) {
      const response: ApiResponse = {
        success: true,
        message: '从助记词创建钱包成功',
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

// 从私钥创建钱包
app.post('/api/wallets/create-from-private-key', (req: Request, res: Response) => {
  try {
    const { device, chainType, privateKey } = req.body as { device: string; chainType: 'evm' | 'btc' | 'solana'; privateKey: string };

    // 验证必需参数
    if (!device || !chainType || !privateKey) {
      const response: ApiResponse = {
        success: false,
        error: '缺少必需参数: device, chainType, privateKey'
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
    const result = walletService.createWalletFromPrivateKey(privateKey, device, chainType);

    if (result.success) {
      const response: ApiResponse = {
        success: true,
        message: '从私钥创建钱包成功',
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

// 验证钱包地址
app.get('/api/wallets/validate-address', (req: Request, res: Response) => {
  try {
    const { address, chainType } = req.query as { address: string; chainType: string };

    if (!address || !chainType) {
      const response: ApiResponse = {
        success: false,
        error: '缺少必需参数: address, chainType'
      };
      return res.status(400).json(response);
    }

    if (!['evm', 'btc', 'solana'].includes(chainType)) {
      const response: ApiResponse = {
        success: false,
        error: '不支持的链类型，支持的类型: evm, btc, solana'
      };
      return res.status(400).json(response);
    }

    const isValid = walletService.validateAddress(address, chainType as 'evm' | 'btc' | 'solana');

    const response: ApiResponse = {
      success: true,
      message: isValid ? '地址格式有效' : '地址格式无效',
      data: {
        address,
        chainType,
        isValid
      }
    };
    return res.json(response);

  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: `服务器错误: ${error instanceof Error ? error.message : '未知错误'}`
    };
    return res.status(500).json(response);
  }
});

// 生成助记词
app.get('/api/mnemonic/generate', (req: Request, res: Response) => {
  try {
    const { strength = '256', language = 'english' } = req.query as { strength?: string; language?: string };

    const mnemonic = walletService.generateMnemonic({
      strength: parseInt(strength || '256') as 128 | 160 | 192 | 224 | 256,
      language: language as any
    });

    const response: ApiResponse = {
      success: true,
      message: '助记词生成成功',
      data: {
        mnemonic,
        strength: parseInt(strength || '256'),
        language
      }
    };
    return res.json(response);

  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: `服务器错误: ${error instanceof Error ? error.message : '未知错误'}`
    };
    return res.status(500).json(response);
  }
});

// 404处理
app.use((req: Request, res: Response) => {
  const response: ApiResponse = {
    success: false,
    error: '接口不存在',
    data: {
      path: req.originalUrl,
      method: req.method
    }
  };
  res.status(404).json(response);
});

// 错误处理中间件
app.use((error: Error, req: Request, res: Response, next: any) => {
  console.error('服务器错误:', error);
  const response: ApiResponse = {
    success: false,
    error: '服务器内部错误',
    data: {
      message: error.message
    }
  };
  res.status(500).json(response);
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`签名器服务器运行在端口 ${PORT}`);
  console.log(`访问 http://localhost:${PORT} 查看API`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('正在关闭签名器服务器...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('正在关闭签名器服务器...');
  process.exit(0);
});
