import { DatabaseConnection } from '../db/connection';
import { SignerService } from './signerService';

/**
 * 热钱包管理服务
 * 负责从 internal_wallets 表中获取和管理热钱包，支持高并发提现场景下的 nonce 管理
 */
export class HotWalletService {
  private db: DatabaseConnection;
  private signerService: SignerService;

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.signerService = new SignerService();
  }

  /**
   * 获取当前 nonce（不递增）
   */
  async getCurrentNonce(address: string, chainId: number): Promise<number> {
    // 1. 从数据库获取当前 nonce
    const currentNonce = await this.db.getCurrentNonce(address, chainId);
    console.log('从数据库获取nonce:', currentNonce);
    // 2. 如果数据库中没有记录（nonce为-1且地址不存在），从链上获取并保存
    if (currentNonce === -1) {
      try {
        const { chainConfigManager } = await import('../utils/chains');
        const chainNonce = await chainConfigManager.getNonce(address, chainId);
        
        console.log('从链上获取nonce:', chainNonce);
        // 保存链上的nonce到数据库
        await this.syncNonceFromChain(address, chainId, chainNonce);
        return chainNonce;
      } catch (error) {
        console.error('从链上获取nonce失败，使用默认值0:', error);
        return 0;
      }
    }
    
    // 3. 返回数据库中的nonce（不递增）
    return currentNonce;
  }

  /**
   * 标记nonce已使用（在交易发出后调用）
   */
  async markNonceUsed(address: string, chainId: number, usedNonce: number): Promise<void> {
    try {
      // 原子性更新nonce为已使用的nonce + 1
      const result = await this.db.atomicIncrementNonce(address, chainId, usedNonce);
      
      if (!result.success) {
        throw new Error(`Failed to mark nonce ${usedNonce} as used for wallet ${address} on chain ${chainId}`);
      }
      
      console.log(`✅ Nonce ${usedNonce} 已标记为已使用，下一个nonce: ${result.newNonce}`);
    } catch (error) {
      console.error('标记nonce已使用失败:', error);
      throw error;
    }
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
    return await this.db.syncNonceFromChain(address, chainId, chainNonce);
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
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

}