import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as readline from 'readline';
import { AddressService } from './services/addressService';
import { createSignerRoutes } from './routes/signer';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// 交互式密码输入（隐藏输入）
async function promptForPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log('请输入助记词密码（至少8个字符）:');
    
    // 检查是否支持原始模式（交互式终端）
    const isTTY = process.stdin.isTTY;
    
    if (isTTY && process.stdin.setRawMode) {
      // 交互式终端，使用隐藏输入
      process.stdout.write('密码: ');
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      let password = '';
      
      const onData = (char: string) => {
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            
            if (!password) {
              console.error('错误: 密码不能为空');
              process.exit(1);
            }
            
            if (password.length < 8) {
              console.error('错误: 密码长度至少需要8个字符');
              process.exit(1);
            }
            
            resolve(password);
            break;
          case '\u0003': // Ctrl+C
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            console.log('\n\n操作已取消');
            process.exit(0);
            break;
          case '\u007f': // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            password += char;
            process.stdout.write('*');
            break;
        }
      };
      
      process.stdin.on('data', onData);
    } else {
      // 非交互式终端（如管道输入），使用简单输入
      process.stdout.write('密码: ');
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      let password = '';
      
      const onData = (data: string) => {
        password = data.trim();
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        
        if (!password) {
          console.error('错误: 密码不能为空');
          process.exit(1);
        }
        
        if (password.length < 8) {
          console.error('错误: 密码长度至少需要8个字符');
          process.exit(1);
        }
        
        resolve(password);
      };
      
      process.stdin.on('data', onData);
    }
  });
}

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 异步初始化服务
async function initializeService() {
  try {
    // 提示用户输入密码
    const password = await promptForPassword();
    
    // 初始化地址服务，传入密码
    const addressService = new AddressService(password);
    
    // 初始化服务（等待数据库初始化并加载配置）
    console.log('正在初始化地址服务...');
    await addressService.initialize();
    
    // 验证密码正确性
    console.log('正在验证密码...');
    const isValid = await addressService.validatePassword();
    
    if (!isValid) {
      console.error('密码验证失败，服务启动中止');
      console.error('请检查密码是否正确');
      process.exit(1);
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

    const signerRouter = createSignerRoutes(addressService);
    app.use('/api/signer', signerRouter);
    
    // 添加调试中间件（仅在开发环境）
    if (process.env.ENV !== 'production') {
      app.use('/api/signer', (req, res, next) => {
        console.log('收到签名器请求:', req.method, req.path, req.body);
        next();
      });
    }
    
    // 404处理 - 必须在所有路由之后
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
      console.log(`\n签名器服务器运行在端口 ${PORT}`);
      console.log(`访问 http://localhost:${PORT} 查看API`);
      console.log(`健康检查: http://localhost:${PORT}/health`);
      console.log(`使用密码保护助记词派生`);
    });
    
  } catch (error) {
    console.error('服务初始化失败:', error);
    process.exit(1);
  }
}

// API响应接口
interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}




// 启动服务
initializeService();

// 优雅关闭
process.on('SIGINT', () => {
  console.log('正在关闭签名器服务器...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('正在关闭签名器服务器...');
  process.exit(0);
});
