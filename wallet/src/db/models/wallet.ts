import { DatabaseConnection } from '../connection';

// 钱包接口定义
export interface Wallet {
  id?: number;
  user_id: number;
  address: string;
  device?: string;
  path?: string;
  chain_type: 'evm' | 'btc' | 'solana';
  wallet_type?: 'user' | 'hot' | 'multisig' | 'cold' | 'vault';
  is_active?: number;
  created_at?: string;
  updated_at?: string;
}

// 创建钱包请求接口
export interface CreateWalletRequest {
  user_id: number;
  address: string;
  device?: string;
  path?: string;
  chain_type: 'evm' | 'btc' | 'solana';
}

// 钱包更新接口
export interface UpdateWalletRequest {
  balance?: number;
}

// 钱包数据模型类
export class WalletModel {
  private db: DatabaseConnection;

  constructor(database: DatabaseConnection) {
    this.db = database;
  }


  // 根据ID查找钱包
  async findById(id: number): Promise<Wallet | null> {
    const wallet = await this.db.queryOne<Wallet>(
      'SELECT * FROM wallets WHERE id = ?',
      [id]
    );
    return wallet || null;
  }

  // 根据地址查找钱包
  async findByAddress(address: string): Promise<Wallet | null> {
    const wallet = await this.db.queryOne<Wallet>(
      'SELECT * FROM wallets WHERE address = ?',
      [address]
    );
    return wallet || null;
  }

  // 根据用户ID查找钱包
  async findByUserId(userId: number): Promise<Wallet | null> {
    const wallet = await this.db.queryOne<Wallet>(
      'SELECT * FROM wallets WHERE user_id = ?',
      [userId]
    );
    return wallet || null;
  }

  // 根据用户ID和链类型查找钱包
  async findByUserIdAndChainType(userId: number, chainType: 'evm' | 'btc' | 'solana'): Promise<Wallet | null> {
    const wallet = await this.db.queryOne<Wallet>(
      'SELECT * FROM wallets WHERE user_id = ? AND chain_type = ?',
      [userId, chainType]
    );
    return wallet || null;
  }

  // 获取所有钱包
  async findAll(): Promise<Wallet[]> {
    return await this.db.query<Wallet>('SELECT * FROM wallets ORDER BY created_at DESC');
  }


  // 检查钱包是否存在
  async exists(id: number): Promise<boolean> {
    const result = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM wallets WHERE id = ?',
      [id]
    );
    
    return (result?.count || 0) > 0;
  }

  // 检查地址是否已存在
  async addressExists(address: string): Promise<boolean> {
    const result = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM wallets WHERE address = ?',
      [address]
    );
    
    return (result?.count || 0) > 0;
  }

  // 获取钱包统计信息
  async getStats(): Promise<{
    totalWallets: number;
    evmWallets: number;
    btcWallets: number;
    solanaWallets: number;
  }> {
    const result = await this.db.queryOne<{
      totalWallets: number;
      evmWallets: number;
      btcWallets: number;
      solanaWallets: number;
    }>(`
      SELECT 
        COUNT(*) as totalWallets,
        SUM(CASE WHEN chain_type = 'evm' THEN 1 ELSE 0 END) as evmWallets,
        SUM(CASE WHEN chain_type = 'btc' THEN 1 ELSE 0 END) as btcWallets,
        SUM(CASE WHEN chain_type = 'solana' THEN 1 ELSE 0 END) as solanaWallets
      FROM wallets
    `);

    return result || {
      totalWallets: 0,
      evmWallets: 0,
      btcWallets: 0,
      solanaWallets: 0
    };
  }

  // 获取安全的钱包信息
  async findByIdSafe(id: number): Promise<Wallet | null> {
    const wallet = await this.db.queryOne<Wallet>(
      'SELECT id, address, device, path, chain_type, created_at, updated_at FROM wallets WHERE id = ?',
      [id]
    );
    return wallet || null;
  }

  // 获取所有安全的钱包信息
  async findAllSafe(): Promise<Wallet[]> {
    return await this.db.query<Wallet>(
      'SELECT id, address, device, path, chain_type, created_at, updated_at FROM wallets ORDER BY created_at DESC'
    );
  }
}
