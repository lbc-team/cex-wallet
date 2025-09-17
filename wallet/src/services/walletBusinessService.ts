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
   * 获取用户余额总和（所有链的总和）
   */
  async getUserTotalBalance(userId: number): Promise<{
    success: boolean;
    data?: {
      token_symbol: string;
      total_balance: string;
      chain_count: number;
    }[];
    error?: string;
  }> {
    try {
      const balances = await this.dbService.balances.getUserTotalBalancesByToken(userId);
      return {
        success: true,
        data: balances
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取用户余额失败'
      };
    }
  }

  /**
   * 获取用户充值中的余额
   */
  async getUserPendingDeposits(userId: number): Promise<{
    success: boolean;
    data?: {
      token_symbol: string;
      pending_amount: string;
      transaction_count: number;
    }[];
    error?: string;
  }> {
    try {
      const pendingDeposits = await this.dbService.transactions.getUserPendingDepositBalances(userId);
      return {
        success: true,
        data: pendingDeposits
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取充值中余额失败'
      };
    }
  }

  /**
   * 获取用户指定代币的余额详情（处理不同链的decimals）
   */
  async getUserTokenBalance(userId: number, tokenSymbol: string): Promise<{
    success: boolean;
    data?: {
      token_symbol: string;
      chain_details: {
        chain_type: string;
        token_id: number;
        balance: string;
        decimals: number;
        normalized_balance: string;
      }[];
      total_normalized_balance: string;
      chain_count: number;
    };
    error?: string;
  }> {
    try {
      const tokenBalance = await this.dbService.balances.getUserTokenBalance(userId, tokenSymbol);
      
      if (!tokenBalance) {
        return {
          success: false,
          error: `用户没有 ${tokenSymbol} 代币余额`
        };
      }

      return {
        success: true,
        data: tokenBalance
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取代币余额失败'
      };
    }
  }


}
