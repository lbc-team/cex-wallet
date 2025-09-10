import { DatabaseService } from '../db';
import { CreateWalletRequest } from '../db';
import { SignerService } from './signerService';

// 钱包业务逻辑服务
export class WalletBusinessService {
  private dbService: DatabaseService;
  private signerService: SignerService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
    this.signerService = new SignerService();
  }

  /**
   * 获取用户钱包地址
   */
  async getUserWallet(userId: number, chainType: 'evm' | 'btc' | 'solana'): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      // 首先检查用户是否已有钱包
      const existingWallet = await this.dbService.wallets.findByUserId(userId);
      if (existingWallet) {
        const responseData = {
          id: existingWallet.id,
          user_id: existingWallet.user_id,
          address: existingWallet.address,
          chain_type: existingWallet.chain_type,
          path: existingWallet.path,
          created_at: existingWallet.created_at,
          updated_at: existingWallet.updated_at
        };
        
        return {
          success: true,
          data: responseData
        };
      }

      // 用户没有钱包，需要创建新钱包
      // 检查 signer 模块是否可用
      const isSignerHealthy = await this.signerService.checkHealth();
      if (!isSignerHealthy) {
        return {
          success: false,
          error: 'Signer 模块不可用，请检查服务状态'
        };
      }

      // 通过 signer 服务创建钱包
      const walletData = await this.signerService.createWallet(chainType);

      // 检查生成的地址是否已被其他用户使用
      const addressExists = await this.dbService.wallets.findByAddress(walletData.address);
      if (addressExists) {
        return {
          success: false,
          error: '生成的钱包地址已被使用，请重试'
        };
      }

      // 将钱包数据写入数据库
      const dbWalletData: CreateWalletRequest = {
        user_id: userId,
        address: walletData.address,
        chain_type: walletData.chainType,
        device: walletData.device,
        path: walletData.path
      };
      
      const wallet = await this.dbService.wallets.create(dbWalletData);
      
      // 返回给前端的数据，移除 device 字段
      const responseData = {
        id: wallet.id,
        user_id: wallet.user_id,
        address: wallet.address,
        chain_type: wallet.chain_type,
        path: wallet.path,
        created_at: wallet.created_at,
        updated_at: wallet.updated_at
      };
      
      return {
        success: true,
        data: responseData
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取用户钱包失败'
      };
    }
  }

  /**
   * 获取钱包余额
   */
  async getWalletBalance(walletId: number): Promise<{
    success: boolean;
    data?: { balance: number };
    error?: string;
  }> {
    try {
      const balance = await this.dbService.wallets.getBalance(walletId);
      return {
        success: true,
        data: { balance }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取钱包余额失败'
      };
    }
  }

  /**
   * 更新钱包余额
   */
  async updateWalletBalance(walletId: number, balance: number): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await this.dbService.wallets.updateBalance(walletId, balance);
      return {
        success: true
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '更新钱包余额失败'
      };
    }
  }

}
