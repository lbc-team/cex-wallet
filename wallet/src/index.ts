import express, { Request, Response } from 'express';
import { 
  initDatabaseService, 
  getDatabaseService,
  Wallet,
  Transaction,
  CreateWalletRequest,
  CreateTransactionRequest,
  TransactionQueryOptions
} from './db';

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

// 获取所有钱包
app.get('/api/wallets', async (req: Request, res: Response) => {
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
app.post('/api/wallets', async (req: Request<{}, ApiResponse, CreateWalletRequest>, res: Response) => {
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
app.get('/api/wallets/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    
    if (isNaN(walletId)) {
      const errorResponse: ApiResponse = { error: '无效的钱包ID' };
      res.status(400).json(errorResponse);
      return;
    }

    const wallet = await dbService.wallets.findByIdSafe(walletId);
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
app.get('/api/wallets/:id/balance', async (req: Request<{ id: string }>, res: Response) => {
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
app.put('/api/wallets/:id/balance', async (req: Request<{ id: string }, ApiResponse, { balance: number }>, res: Response) => {
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

// 获取钱包交易记录
app.get('/api/wallets/:id/transactions', async (req: Request<{ id: string }, ApiResponse, {}, TransactionQueryOptions>, res: Response) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    
    if (isNaN(walletId)) {
      const errorResponse: ApiResponse = { error: '无效的钱包ID' };
      res.status(400).json(errorResponse);
      return;
    }

    // 解析查询参数
    const options: TransactionQueryOptions = {
      from_addr: req.query.from_addr as string,
      to_addr: req.query.to_addr as string,
      token_addr: req.query.token_addr as string,
      type: req.query.type as any,
      status: req.query.status as any,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
      offset: req.query.offset ? parseInt(String(req.query.offset), 10) : undefined,
      orderBy: req.query.orderBy as any,
      orderDirection: req.query.orderDirection as any
    };

    const transactions = await dbService.transactions.findAll(options);
    const response: ApiResponse<Transaction[]> = { data: transactions };
    res.json(response);
  } catch (error) {
    const errorResponse: ApiResponse = { 
      error: error instanceof Error ? error.message : '获取交易记录失败' 
    };
    res.status(500).json(errorResponse);
  }
});

// 创建交易记录
app.post('/api/transactions', async (req: Request<{}, ApiResponse, {
  block_hash?: string;
  block_no?: number;
  tx_hash: string;
  from_addr: string;
  to_addr: string;
  token_addr?: string;
  amount: number;
  fee?: number;
  type: 'deposit' | 'withdraw' | 'collect' | 'rebalance';
  status?: 'pending' | 'confirmed' | 'failed';
}>, res: Response) => {
  try {
    const { block_hash, block_no, tx_hash, from_addr, to_addr, token_addr, amount, fee, type, status = 'pending' } = req.body;
    
    if (!tx_hash || !from_addr || !to_addr || !amount || !type) {
      const errorResponse: ApiResponse = { error: '缺少必需字段' };
      res.status(400).json(errorResponse);
      return;
    }

    // 检查交易哈希是否已存在
    const hashExists = await dbService.transactions.hashExists(tx_hash);
    if (hashExists) {
      const errorResponse: ApiResponse = { error: '交易哈希已存在' };
      res.status(409).json(errorResponse);
      return;
    }

    const transactionData: CreateTransactionRequest = {
      tx_hash,
      from_addr,
      to_addr,
      amount,
      type,
      status
    };
    if (block_hash) transactionData.block_hash = block_hash;
    if (block_no) transactionData.block_no = block_no;
    if (token_addr) transactionData.token_addr = token_addr;
    if (fee) transactionData.fee = fee;
    
    const transaction = await dbService.transactions.create(transactionData);

    const response: ApiResponse<Transaction> = { 
      message: '交易记录创建成功',
      data: transaction
    };
    res.json(response);
  } catch (error) {
    const errorResponse: ApiResponse = { 
      error: error instanceof Error ? error.message : '创建交易记录失败' 
    };
    res.status(500).json(errorResponse);
  }
});

// 获取钱包统计信息
app.get('/api/wallets/:id/stats', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    
    if (isNaN(walletId)) {
      const errorResponse: ApiResponse = { error: '无效的钱包ID' };
      res.status(400).json(errorResponse);
      return;
    }

    const [walletStats, transactionStats] = await Promise.all([
      dbService.wallets.getStats(),
      dbService.transactions.getStats(walletId)
    ]);

    const response: ApiResponse = { 
      data: {
        wallet: walletStats,
        transactions: transactionStats
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

// 启动服务器
async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`钱包服务器运行在端口 ${PORT}`);
      console.log(`访问 http://localhost:${PORT} 查看API`);
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