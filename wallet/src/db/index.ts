// 数据库模块导出
export { DatabaseConnection, getDatabase, initDatabase } from './connection';
export { 
  WalletModel, 
  Wallet, 
  CreateWalletRequest, 
  UpdateWalletRequest 
} from './models/wallet';
export { 
  TransactionModel, 
  Transaction, 
  CreateTransactionRequest, 
  UpdateTransactionRequest,
  TransactionQueryOptions 
} from './models/transaction';
export { 
  UserModel, 
  User, 
  CreateUserRequest, 
  UpdateUserRequest,
  UserQueryOptions 
} from './models/user';
export { 
  BalanceModel, 
  Balance, 
  CreateBalanceRequest, 
  UpdateBalanceRequest,
  BalanceQueryOptions 
} from './models/balance';

// 导入类型和函数用于内部使用
import { DatabaseConnection, getDatabase, initDatabase } from './connection';
import { WalletModel } from './models/wallet';
import { TransactionModel } from './models/transaction';
import { UserModel } from './models/user';
import { BalanceModel } from './models/balance';

// 数据库服务类 - 统一管理所有模型
export class DatabaseService {
  private connection: DatabaseConnection;
  public users: UserModel;
  public wallets: WalletModel;
  public transactions: TransactionModel;
  public balances: BalanceModel;

  constructor(connection: DatabaseConnection) {
    this.connection = connection;
    this.users = new UserModel(connection);
    this.wallets = new WalletModel(connection);
    this.transactions = new TransactionModel(connection);
    this.balances = new BalanceModel(connection);
  }

  // 获取数据库连接
  getConnection(): DatabaseConnection {
    return this.connection;
  }

  // 关闭数据库连接
  async close(): Promise<void> {
    await this.connection.close();
  }
}

// 单例数据库服务实例
let dbService: DatabaseService | null = null;

// 获取数据库服务实例
export function getDatabaseService(): DatabaseService {
  if (!dbService) {
    const connection = getDatabase();
    dbService = new DatabaseService(connection);
  }
  return dbService;
}

// 初始化数据库服务
export async function initDatabaseService(): Promise<DatabaseService> {
  const connection = await initDatabase();
  dbService = new DatabaseService(connection);
  return dbService;
}
