import { DatabaseService } from '../db';
import { CreateWalletRequest } from '../db';
import { SignerService } from './signerService';
import { BalanceService } from './balanceService';
import { GasEstimationService } from './gasEstimationService';
import { HotWalletService } from './hotWalletService';

// 钱包业务逻辑服务
export class WalletBusinessService {
  private dbService: DatabaseService;
  private signerService: SignerService;
  private balanceService: BalanceService;
  private gasEstimationService: GasEstimationService;
  private hotWalletService: HotWalletService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
    this.signerService = new SignerService();
    this.balanceService = new BalanceService(dbService);
    this.gasEstimationService = new GasEstimationService();
    this.hotWalletService = new HotWalletService(dbService.getConnection());
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
   * 获取用户余额总和（所有链的总和）- 使用 Credits 
   */
  async getUserTotalBalance(userId: number): Promise<{
    success: boolean;
    data?: {
      token_symbol: string;
      total_balance: string;
      available_balance: string;
      frozen_balance: string;
      address_count: number;
    }[];
    error?: string;
  }> {
    try {
      // 使用Credits系统获取用户余额
      const balances = await this.balanceService.getUserTotalBalancesByToken(userId);
      
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
      // 使用Credits系统获取用户指定代币余额
      const balances = await this.balanceService.getUserBalances(userId);
      const tokenBalances = balances.filter(b => b.token_symbol === tokenSymbol);
      
      if (tokenBalances.length === 0) {
        return {
          success: false,
          error: `用户没有 ${tokenSymbol} 代币余额`
        };
      }

      // 简化返回格式，只返回第一个地址的余额信息
      const firstBalance = tokenBalances[0]!; // 已经检查了length > 0，所以安全
      return {
        success: true,
        data: {
          token_symbol: tokenSymbol,
          chain_details: [{
            chain_type: 'eth', // 简化处理
            token_id: firstBalance.token_id,
            balance: firstBalance.total_balance,
            decimals: firstBalance.decimals,
            normalized_balance: firstBalance.total_balance_formatted
          }],
          total_normalized_balance: firstBalance.total_balance_formatted,
          chain_count: tokenBalances.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取代币余额失败'
      };
    }
  }

  /**
   * 用户提现
   */
  async withdrawFunds(params: {
    userId: number;
    to: string;                // 提现目标地址
    amount: string;            // 提现金额（格式化后的金额，如 "1.5"）
    tokenSymbol: string;       // 代币符号，如 "ETH", "USDT"
    chainId: number;           // 链ID
    chainType: 'evm' | 'btc' | 'solana'; // 链类型
  }): Promise<{
    success: boolean;
    data?: {
      signedTransaction: string;
      transactionHash: string;
      withdrawAmount: string;
      actualAmount: string;    // 实际转账金额（扣除费用后）
      fee: string;             // 提现费用
      withdrawId: number;      // 提现记录ID
      gasEstimation: {
        gasLimit: string;
        maxFeePerGas: string;
        maxPriorityFeePerGas: string;
        networkCongestion: 'low' | 'medium' | 'high';
      };
    };
    error?: string;
  }> {
    let withdrawId: number | undefined;
    
    try {
      // 1. 验证参数
      if (!params.to || !params.amount || !params.tokenSymbol) {
        return {
          success: false,
          error: '缺少必需参数: to, amount, tokenSymbol'
        };
      }

      // 2. 获取用户钱包地址
      const wallet = await this.dbService.wallets.findByUserId(params.userId);
      if (!wallet) {
        return {
          success: false,
          error: '用户钱包不存在'
        };
      }

      // 3. 查找代币信息
      const tokenInfo = await this.dbService.getConnection().findTokenBySymbol(params.tokenSymbol, params.chainId);
      if (!tokenInfo) {
        return {
          success: false,
          error: `不支持的代币: ${params.tokenSymbol}`
        };
      }

      // 4. 将用户输入的金额转换为最小单位
      const requestedAmountBigInt = BigInt(Math.floor(parseFloat(params.amount) * Math.pow(10, tokenInfo.decimals)));
      
      // 5. 获取提现费用并计算实际转账金额
      const withdrawFee = (tokenInfo as any).withdraw_fee || '0';
      const actualAmount = requestedAmountBigInt - BigInt(withdrawFee);
      
      // 6. 检查用户余额是否充足（包含费用）
      const balanceCheck = await this.balanceService.checkSufficientBalance(
        params.userId,
        tokenInfo.id,
        requestedAmountBigInt.toString()
      );

      if (!balanceCheck.sufficient) {
        return {
          success: false,
          error: `余额不足。可用余额: ${(BigInt(balanceCheck.availableBalance) / BigInt(Math.pow(10, tokenInfo.decimals))).toString()} ${params.tokenSymbol}`
        };
      }

      // 7. 检查 signer 模块是否可用
      const isSignerHealthy = await this.signerService.checkHealth();
      if (!isSignerHealthy) {
        return {
          success: false,
          error: 'Signer 模块不可用，请稍后再试'
        };
      }

      // 8. 创建提现记录（状态：user_withdraw_request）
      const withdrawId = await this.dbService.getConnection().createWithdraw({
        userId: params.userId,
        toAddress: params.to,
        tokenId: tokenInfo.id,
        amount: requestedAmountBigInt.toString(),
        fee: withdrawFee,
        chainId: params.chainId,
        chainType: params.chainType,
        status: 'user_withdraw_request'
      });

      // 9. 创建 credit 流水记录（扣除余额）
      await this.dbService.getConnection().createCredit({
        user_id: params.userId,
        token_id: tokenInfo.id,
        token_symbol: params.tokenSymbol,
        amount: `-${requestedAmountBigInt.toString()}`,
        chain_id: params.chainId,
        chain_type: params.chainType,
        reference_id: withdrawId,
        reference_type: 'withdraw',
        address: params.to,
        credit_type: 'withdraw',
        business_type: 'withdraw',
        status: 'pending'
      });

      // 10. 选择热钱包并获取 nonce
      let hotWallet;
      let nonce: number;
      let gasEstimation;
      try {
        // 选择最优热钱包
        hotWallet = await this.hotWalletService.selectOptimalHotWallet(
          params.chainId, 
          params.chainType,
          'hot'  // 默认选择热钱包
        );
        
        if (!hotWallet) {
          return {
            success: false,
            error: '没有可用的热钱包'
          };
        }

        // 获取热钱包的 nonce
        nonce = await this.hotWalletService.getNextNonce(
          hotWallet.address, 
          params.chainId
        );
        
        // 更新提现状态为 signing（填充 from 地址等信息）
        await this.dbService.getConnection().updateWithdrawStatus(withdrawId, 'signing', {
          fromAddress: hotWallet.address,
          nonce: nonce
        });

        // 估算 gas 费用（使用实际转账金额）
        if (tokenInfo.is_native) {
          // ETH 转账
          gasEstimation = await this.gasEstimationService.estimateEthTransfer({
            from: hotWallet.address,
            to: params.to,
            amount: actualAmount.toString(),
            chainId: params.chainId
          });
        } else {
          // ERC20 转账
          gasEstimation = await this.gasEstimationService.estimateErc20Transfer({
            from: hotWallet.address,
            to: params.to,
            tokenAddress: tokenInfo.token_address!,
            amount: actualAmount.toString(),
            chainId: params.chainId
          });
        }
      } catch (error) {
        // 更新提现状态为失败
        await this.dbService.getConnection().updateWithdrawStatus(withdrawId, 'failed', {
          errorMessage: `选择热钱包或获取 nonce 失败: ${error instanceof Error ? error.message : '未知错误'}`
        });
        
        return {
          success: false,
          error: `选择热钱包或获取 nonce 失败: ${error instanceof Error ? error.message : '未知错误'}`
        };
      }

      // 8. 构建签名请求（使用自动估算的 gas 参数和获取的 nonce）
      const signRequest: {
        address: string;
        to: string;
        amount: string;
        tokenAddress?: string;
        gas: string;
        maxFeePerGas: string;
        maxPriorityFeePerGas: string;
        nonce: number;
        chainId: number;
        chainType: 'evm' | 'btc' | 'solana';
        type: 2; // 使用 EIP-1559
      } = {
        address: hotWallet.address, // 使用热钱包地址
        to: params.to,
        amount: actualAmount.toString(),
        gas: gasEstimation.gasLimit,
        maxFeePerGas: gasEstimation.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimation.maxPriorityFeePerGas,
        nonce: nonce,
        chainId: params.chainId,
        chainType: params.chainType,
        type: 2
      };

      // 只有非原生代币才设置 tokenAddress
      if (!tokenInfo.is_native && tokenInfo.token_address) {
        signRequest.tokenAddress = tokenInfo.token_address;
      }

      // 11. 请求 Signer 签名交易
      const signResult = await this.signerService.signTransaction(signRequest);

      if (!(signResult as any).success) {
        // 更新提现状态为失败
        await this.dbService.getConnection().updateWithdrawStatus(withdrawId, 'failed', {
          errorMessage: `签名失败: ${(signResult as any).error}`
        });
        
        return {
          success: false,
          error: `签名失败: ${(signResult as any).error}`
        };
      }

      // 12. 更新提现状态为 pending
      await this.dbService.getConnection().updateWithdrawStatus(withdrawId, 'pending', {
        txHash: signResult.transactionHash,
        gasPrice: gasEstimation.gasPrice,
        maxFeePerGas: gasEstimation.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimation.maxPriorityFeePerGas
      });

      return {
        success: true,
        data: {
          signedTransaction: signResult.signedTransaction,
          transactionHash: signResult.transactionHash,
          withdrawAmount: params.amount,
          actualAmount: actualAmount.toString(),
          fee: withdrawFee,
          withdrawId: withdrawId,
          gasEstimation: {
            gasLimit: gasEstimation.gasLimit,
            maxFeePerGas: gasEstimation.maxFeePerGas,
            maxPriorityFeePerGas: gasEstimation.maxPriorityFeePerGas,
            networkCongestion: gasEstimation.networkCongestion
          }
        }
      };

    } catch (error) {
      // 如果有 withdrawId，更新提现状态为失败
      if (withdrawId !== undefined) {
        try {
          await this.dbService.getConnection().updateWithdrawStatus(withdrawId, 'failed', {
            errorMessage: error instanceof Error ? error.message : '提现失败'
          });
        } catch (updateError) {
          console.error('更新提现状态失败:', updateError);
        }
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : '提现失败'
      };
    }
  }


}
