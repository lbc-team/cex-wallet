import { DatabaseConnection } from '../connection';
import { BalanceModel } from './balance';

// 钱包接口定义
export interface Wallet {
  id?: number;
  address: string;
  device?: string;
  path?: string;
  chain_type: 'evm' | 'btc' | 'solana';
  created_at?: string;
  updated_at?: string;
}

// 创建钱包请求接口
export interface CreateWalletRequest {
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
  private balanceModel: BalanceModel;

  constructor(database: DatabaseConnection) {
    this.db = database;
    this.balanceModel = new BalanceModel(database);
  }

  // 创建新钱包
  async create(walletData: CreateWalletRequest): Promise<Wallet> {
    const { address, device, path, chain_type } = walletData;
    
    const result = await this.db.run(
      'INSERT INTO wallets (address, device, path, chain_type) VALUES (?, ?, ?, ?)',
      [address, device, path, chain_type]
    );

    const newWallet = await this.findById(result.lastID);
    if (!newWallet) {
      throw new Error('创建钱包后无法获取钱包信息');
    }

    return newWallet;
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

  // 获取所有钱包
  async findAll(): Promise<Wallet[]> {
    return await this.db.query<Wallet>('SELECT * FROM wallets ORDER BY created_at DESC');
  }

  // 获取钱包余额（从余额表获取）
  async getBalance(id: number): Promise<number> {
    // 获取钱包地址
    const wallet = await this.findById(id);
    if (!wallet) {
      throw new Error('钱包不存在');
    }

    // 使用余额模型获取余额总和
    return await this.balanceModel.getTotalBalanceByAddress(wallet.address);
  }

  // 更新钱包余额（更新balances表）
  async updateBalance(id: number, balance: number): Promise<void> {
    // 获取钱包地址
    const wallet = await this.findById(id);
    if (!wallet) {
      throw new Error('钱包不存在');
    }

    // 使用余额模型更新余额
    await this.balanceModel.updateWalletBalance(wallet.address, 'ETH', balance);
  }

  // 更新钱包信息
  async update(id: number, updateData: UpdateWalletRequest): Promise<Wallet> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updateData.balance !== undefined) {
      fields.push('balance = ?');
      values.push(updateData.balance);
    }

    if (fields.length === 0) {
      throw new Error('没有要更新的字段');
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const sql = `UPDATE wallets SET ${fields.join(', ')} WHERE id = ?`;
    const result = await this.db.run(sql, values);

    if (result.changes === 0) {
      throw new Error('钱包不存在或更新失败');
    }

    const updatedWallet = await this.findById(id);
    if (!updatedWallet) {
      throw new Error('更新后无法获取钱包信息');
    }

    return updatedWallet;
  }

  // 删除钱包
  async delete(id: number): Promise<void> {
    const result = await this.db.run('DELETE FROM wallets WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      throw new Error('钱包不存在或删除失败');
    }
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
