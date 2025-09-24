import { DatabaseConnection } from '../db/connection';
import { SignerService } from './signerService';

/**
 * 热钱包管理服务
 * 负责从 internal_wallets 表中获取和管理热钱包，支持高并发提现场景下的 nonce 管理
 */
export class HotWalletService {
  private db: DatabaseConnection;
  private signerService: SignerService;
  private nonceCache = new Map<string, number>();

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.signerService = new SignerService();
  }

  /**
   * 获取下一个 nonce（原子操作）
   */
  async getNextNonce(address: string, chainId: number): Promise<number> {
    const key = `${chainId}:${address}`;
    
    // 1. 从数据库获取当前 nonce
    const currentNonce = await this.db.getCurrentNonce(address, chainId);
    
    // 2. 原子性更新 nonce
    const result = await this.db.atomicIncrementNonce(address, chainId, currentNonce);
    
    if (!result.success) {
      throw new Error(`Nonce conflict for wallet ${address} on chain ${chainId}`);
    }
    
    // 3. 更新缓存
    this.nonceCache.set(key, result.newNonce);
    
    return result.newNonce;
  }


  /**
   * 选择最优热钱包
   */
  async selectOptimalHotWallet(
    chainId: number, 
    chainType: string, 
    walletType: 'hot' | 'multisig' | 'cold' | 'vault' = 'hot',
    amount?: string
  ): Promise<{
    address: string;
    nonce: number;
    device?: string;
  } | null> {
    // 1. 获取可用的内部钱包列表
    const availableWallets = await this.db.getAvailableInternalWallets(chainId, chainType, walletType);
    
    if (availableWallets.length === 0) {
      throw new Error(`No available ${walletType} wallets for chain ${chainId}`);
    }

    // 2. 选择策略：优先选择 nonce 最低的钱包
    const sortedWallets = availableWallets.sort((a, b) => a.nonce - b.nonce);
    const selectedWallet = sortedWallets[0];

    if (!selectedWallet) {
      throw new Error(`No available ${walletType} wallets for chain ${chainId}`);
    }

    const result: {
      address: string;
      nonce: number;
      device?: string;
    } = {
      address: selectedWallet.address,
      nonce: selectedWallet.nonce
    };
    
    if (selectedWallet.device) {
      result.device = selectedWallet.device;
    }
    
    return result;
  }

  /**
   * 创建热钱包（通过签名机）
   */
  async createHotWallet(params: {
    chainType: 'evm' | 'btc' | 'solana';
    chainId: number;
    initialNonce?: number;
  }): Promise<{
    walletId: number;
    address: string;
    device: string;
    path: string;
  }> {
    try {
      // 1. 通过 SignerService 创建钱包
      const signerResult = await this.signerService.createWallet(params.chainType);

      if (!signerResult) {
        throw new Error('签名机创建钱包失败: 返回结果为空');
      }

      const { address, device, path } = signerResult;

      // 2. 保存到 internal_wallets 表
      const walletId = await this.db.createInternalWallet({
        address,
        device,
        path,
        chainType: params.chainType,
        chainId: params.chainId,
        walletType: 'hot',
        nonce: params.initialNonce || 0
      });

      return {
        walletId,
        address,
        device,
        path
      };

    } catch (error) {
      console.error('创建热钱包失败:', error);
      throw new Error(`创建热钱包失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 获取热钱包信息
   */
  async getHotWallet(address: string, chainId: number) {
    return await this.db.getInternalWallet(address, chainId);
  }

  /**
   * 同步 nonce 从链上
   */
  async syncNonceFromChain(address: string, chainId: number, chainNonce: number): Promise<boolean> {
    const success = await this.db.syncNonceFromChain(address, chainId, chainNonce);
    
    if (success) {
      // 更新缓存
      const key = `${chainId}:${address}`;
      this.nonceCache.set(key, chainNonce);
    }
    
    return success;
  }


  /**
   * 获取所有热钱包状态
   */
  async getAllHotWalletsStatus(chainId?: number, walletType?: string): Promise<{
    address: string;
    chainId: number;
    walletType: string;
    nonce: number;
    isActive: boolean;
    lastUpdated: string;
  }[]> {
    let sql = 'SELECT address, chain_id, wallet_type, nonce, is_active, updated_at FROM internal_wallets';
    const params: any[] = [];
    
    if (chainId) {
      sql += ' WHERE chain_id = ?';
      params.push(chainId);
    }
    
    if (walletType) {
      sql += chainId ? ' AND wallet_type = ?' : ' WHERE wallet_type = ?';
      params.push(walletType);
    }
    
    sql += ' ORDER BY chain_id, wallet_type, nonce';
    
    return await this.db.query(sql, params);
  }

  /**
   * 批量同步 nonce
   */
  async batchSyncNonces(chainNonces: Array<{
    address: string;
    chainId: number;
    chainNonce: number;
  }>): Promise<{
    success: number;
    failed: number;
    errors: string[];
  }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const { address, chainId, chainNonce } of chainNonces) {
      try {
        const result = await this.syncNonceFromChain(address, chainId, chainNonce);
        if (result) {
          success++;
        } else {
          failed++;
          errors.push(`Failed to sync nonce for ${address} on chain ${chainId}`);
        }
      } catch (error) {
        failed++;
        errors.push(`Error syncing nonce for ${address}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { success, failed, errors };
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    this.nonceCache.clear();
  }

  /**
   * 获取缓存状态
   */
  getCacheStatus(): { size: number; keys: string[] } {
    return {
      size: this.nonceCache.size,
      keys: Array.from(this.nonceCache.keys())
    };
  }
}