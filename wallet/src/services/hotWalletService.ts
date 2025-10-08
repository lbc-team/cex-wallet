import { DatabaseConnection } from '../db/connection';
import { SignerClient } from './signerClient';
import { getDbGatewayClient } from './dbGatewayClient';

/**
 * 热钱包管理服务，支持高并发提现场景下的 nonce 管理
 */
export class HotWalletService {
  private db: DatabaseConnection;
  private signerClient: SignerClient;
  private dbGatewayClient = getDbGatewayClient();

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.signerClient = new SignerClient();
  }

  /**
   * 获取当前 nonce（不递增）
   */
  async getCurrentNonce(address: string, chainId: number): Promise<number> {
    // 1. 从数据库获取当前 nonce
    const currentNonce = await this.db.getCurrentNonce(address, chainId);
    console.log('从数据库获取nonce:', currentNonce);
    // 2. 如果数据库中没有记录（返回-1），从链上获取并保存
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
      // 通过 db_gateway API 原子性更新nonce为已使用的nonce + 1
      const result = await this.dbGatewayClient.atomicIncrementNonce(address, chainId, usedNonce);

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
    return await this.db.getAllAvailableHotWallets(chainId, chainType);
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
      const signerResult = await this.signerClient.createWallet(params.chainType);

      if (!signerResult) {
        throw new Error('签名机创建钱包失败: 返回结果为空');
      }

      const { address, device, path } = signerResult;

      // 3. 检查钱包地址是否已存在（防止签名机返回重复地址）
      const existingWallet = await this.db.getWallet(address);
      if (existingWallet) {
        throw new Error('签名机返回的地址已存在，请重试');
      }

      // 4. 通过 db_gateway API 保存到 wallets 表
      const wallet = await this.dbGatewayClient.createWallet({
        user_id: systemUserId,
        address,
        device,
        path,
        chain_type: params.chainType,
        wallet_type: 'hot'
      });

      const walletId = wallet.id;
      if (!walletId) {
        throw new Error('创建钱包后未返回有效的钱包ID');
      }

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
    return await this.dbGatewayClient.syncNonceFromChain(address, chainId, chainNonce);
  }

}