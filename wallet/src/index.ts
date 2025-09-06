import 'dotenv/config';
import express, { Request, Response } from 'express';
import { initDatabaseService, getDatabaseService } from './db';
import { walletRoutes } from './routes/wallet';

// API响应接口
interface ApiResponse<T = any> {
  message?: string;
  error?: string;
  data?: T;
}

const app = express();
const PORT: number = parseInt(process.env.PORT || '3000', 10);

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// 数据库服务实例
let dbService: ReturnType<typeof getDatabaseService>;

// 初始化数据库
async function initializeDatabase() {
  try {
    dbService = await initDatabaseService();
    console.log('数据库服务初始化成功');
    
    // 设置路由
    setupRoutes();
  } catch (error) {
    console.error('数据库初始化失败:', error);
    process.exit(1);
  }
}

// 基本路由
app.get('/', (req: Request, res: Response) => {
  const response: ApiResponse = { 
    message: 'CEX钱包系统 - 主模块',
    data: {
      version: '1.0.0',
      status: 'running'
    }
  };
  res.json(response);
});

// 健康检查路由
app.get('/health', (req: Request, res: Response) => {
  const response: ApiResponse = { 
    message: '服务健康',
    data: {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }
  };
  
  res.json(response);
});

// 设置路由
function setupRoutes() {
  // 钱包路由
  app.use('/api', walletRoutes(dbService));
  
  // 404处理 - 必须在所有路由之后
  app.use((req: Request, res: Response) => {
    const response: ApiResponse = { 
      error: '接口不存在',
      data: {
        path: req.originalUrl,
        method: req.method
      }
    };
    res.status(404).json(response);
  });
}

// 错误处理中间件
app.use((error: Error, req: Request, res: Response, next: any) => {
  console.error('服务器错误:', error);
  const response: ApiResponse = { 
    error: '服务器内部错误',
    data: {
      message: error.message
    }
  };
  res.status(500).json(response);
});

// 启动服务器
async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`钱包服务器运行在端口 ${PORT}`);
      console.log(`访问 http://localhost:${PORT} 查看API`);
      console.log(`健康检查: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('服务器启动失败:', error);
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('正在关闭服务器...');
  try {
    if (dbService) {
      await dbService.close();
    }
    console.log('服务器已关闭');
    process.exit(0);
  } catch (error) {
    console.error('关闭服务器时出错:', error);
    process.exit(1);
  }
});

// 启动应用
startServer();

export default app;