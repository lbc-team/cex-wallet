import { DatabaseConnection } from '../db/connection';
import { SignerService } from './signerService';

/**
 * 热钱包管理服务，支持高并发提现场景下的 nonce 管理
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
   * 获取所有可用的热钱包（按 last_used_at 排序）
   */
  async getAllAvailableHotWallets(
    chainId: number, 
    chainType: string
  ): Promise<{
    address: string;
    nonce: number;
    device?: string;
  }[]> {
    // 关联查询 wallets 和 wallet_nonces，按 last_used_at 排序， 确保优先选择最久未使用的热钱包，提升负载均衡。
    const sql = `
      SELECT 
        w.address,
        w.device,
        COALESCE(wn.nonce, 0) as nonce,
        wn.last_used_at
      FROM wallets w
      LEFT JOIN wallet_nonces wn ON w.id = wn.wallet_id AND wn.chain_id = ?
      WHERE w.chain_type = ? AND w.wallet_type = 'hot' AND w.is_active = 1
      ORDER BY 
        CASE WHEN wn.last_used_at IS NULL THEN 0 ELSE 1 END,
        wn.last_used_at ASC
    `;
    
    const results = await this.db.query(sql, [chainId, chainType]);
    
    return results.map((row: any) => {
      const result: {
        address: string;
        nonce: number;
        device?: string;
      } = {
        address: row.address,
        nonce: row.nonce
      };
      
      if (row.device) {
        result.device = row.device;
      }
      
      return result;
    });
  }


  /**
   * 创建热钱包（通过签名机）
   */
  async createHotWallet(params: {
    chainType: 'evm' | 'btc' | 'solana';
  }): Promise<{
    walletId: number;
    address: string;
    device: string;
    path: string;
  }> {
    try {
      // 1. 查找没有钱包地址的系统用户
      const systemUserId = await this.db.getSystemUserIdWithoutWallet('sys_hot_wallet');
      if (!systemUserId) {
        throw new Error('没有可用的热钱包系统用户（所有系统用户都已分配钱包）');
      }

      // 2. 通过 SignerService 创建钱包
      const signerResult = await this.signerService.createWallet(params.chainType);

      if (!signerResult) {
        throw new Error('签名机创建钱包失败: 返回结果为空');
      }

      const { address, device, path } = signerResult;

      // 3. 检查钱包地址是否已存在（防止签名机返回重复地址）
      const existingWallet = await this.db.getWallet(address);
      if (existingWallet) {
        throw new Error('签名机返回的地址已存在，请重试');
      }

      // 4. 保存到 wallets 表
      const walletId = await this.db.createWallet({
        userId: systemUserId,
        address,
        device,
        path,
        chainType: params.chainType,
        walletType: 'hot'
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
  async getHotWallet(address: string) {
    return await this.db.getWallet(address);
  }

  /**
   * 同步 nonce 从链上
   */
  async syncNonceFromChain(address: string, chainId: number, chainNonce: number): Promise<boolean> {
    return await this.db.syncNonceFromChain(address, chainId, chainNonce);
  }

}