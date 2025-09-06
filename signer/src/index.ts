import 'dotenv/config';
import express, { Request, Response } from 'express';
import { AddressService } from './services/addressService';
import { createSignerRoutes } from './routes/signer';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 初始化地址服务
const addressService = new AddressService();

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
        'POST /api/signer/create': '创建新钱包'
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

// 使用签名器路由
app.use('/api/signer', createSignerRoutes(addressService));


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
