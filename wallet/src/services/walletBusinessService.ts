import { DatabaseReader } from '../db';
import { SignerService } from './signerService';
import { BalanceService } from './balanceService';
import { GasEstimationService } from '../utils/gasEstimation';
import { HotWalletService } from './hotWalletService';
import { getDbGatewayService } from './dbGatewayService';
import { normalizeBigIntString, isBigIntStringGreaterOrEqual } from '../utils/numberUtils';
import { chainConfigManager, SupportedChain } from '../utils/chains';
import { type TransactionReceipt } from 'viem';

// 钱包业务逻辑服务
export class WalletBusinessService {
  private dbReader: DatabaseReader;
  private signerService: SignerService;
  private balanceService: BalanceService;
  private gasEstimationService: GasEstimationService;
  private hotWalletService: HotWalletService;
  private dbGatewayService = getDbGatewayService();

  constructor(dbReader: DatabaseReader) {
    this.dbReader = dbReader;
    this.signerService = new SignerService();
    this.balanceService = new BalanceService(dbReader);
    this.gasEstimationService = new GasEstimationService();
    this.hotWalletService = new HotWalletService(dbReader.getConnection());
  }



  /**
   * 选择合适的热钱包
   */
  private async selectHotWallet(params: {
    chainId: number;
    chainType: string;
    requiredAmount: string;
    tokenId: number;
  }): Promise<{
    success: boolean;
    wallet?: {
      address: string;
      nonce: number;
      device?: string;
      userId: number;
    };
    error?: string;
  }> {
    try {
      // 1. 获取所有可用的热钱包
      const availableWallets = await this.hotWalletService.getAllAvailableHotWallets(
        params.chainId, 
        params.chainType
      );
      
      if (availableWallets.length === 0) {
        return {
          success: false,
          error: '没有可用的热钱包'
        };
      }

      // 2. 依次检查热钱包余额，找到第一个余额足够的钱包
      for (const wallet of availableWallets) {
        const walletBalance = await this.balanceService.getWalletBalance(
          wallet.address, 
          params.tokenId
        );

        console.log('🔍 WalletBusinessService: 热钱包余额:', wallet.address, walletBalance);
        
        const normalizedBalance = normalizeBigIntString(walletBalance);
        const normalizedRequiredAmount = normalizeBigIntString(params.requiredAmount);
        
        if (isBigIntStringGreaterOrEqual(normalizedBalance, normalizedRequiredAmount)) {
          // 获取钱包的 nonce 和用户ID
          const nonce = await this.hotWalletService.getCurrentNonce(
            wallet.address, 
            params.chainId
          );

          // 获取钱包信息以获取用户ID
          const walletInfo = await this.dbReader.getConnection().getWallet(wallet.address);
          if (!walletInfo || !walletInfo.user_id) {
            continue; // 跳过没有用户ID的钱包
          }

          const result: {
            success: true;
            wallet: {
              address: string;
              nonce: number;
              device?: string;
              userId: number;
            };
          } = {
            success: true,
            wallet: {
              address: wallet.address,
              nonce: nonce,
              userId: walletInfo.user_id
            }
          };
          
          if (wallet.device) {
            result.wallet.device = wallet.device;
          }
          
          return result;
        }
      }

      return {
        success: false,
        error: '所有热钱包余额都不足，无法完成提现'
      };

    } catch (error) {
      console.error('选择热钱包失败:', error);
      return {
        success: false,
        error: `选择热钱包失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 获取指定链的公共客户端
   */
  private getPublicClient(chain: SupportedChain): any {
    return chainConfigManager.getPublicClient(chain);
  }

  /**
   * 根据chainId获取对应的链类型
   */
  private getChainByChainId(chainId: number): SupportedChain {
    return chainConfigManager.getChainByChainId(chainId);
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
      const existingWallet = await this.dbReader.wallets.findByUserId(userId);
      if (existingWallet) {
        const responseData = {
          id: existingWallet.id,
          user_id: existingWallet.user_id,
          address: existingWallet.address,
          chain_type: existingWallet.chain_type,
          wallet_type: existingWallet.wallet_type,
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
      const addressExists = await this.dbReader.wallets.findByAddress(walletData.address);
      if (addressExists) {
        return {
          success: false,
          error: '生成的钱包地址已被使用，请重试'
        };
      }

      
      // 通过 db_gateway 服务创建钱包
      const wallet = await this.dbGatewayService.createWallet({
        user_id: userId,
        address: walletData.address,
        chain_type: walletData.chainType,
        device: walletData.device,
        path: walletData.path,
        wallet_type: 'user'
      });
      
      // 返回给前端的数据，移除 device 字段
      const responseData = {
        id: wallet.id,
        user_id: wallet.user_id,
        address: wallet.address,
        chain_type: wallet.chain_type,
        wallet_type: wallet.wallet_type,
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
      const pendingDeposits = await this.dbReader.transactions.getUserPendingDepositBalances(userId);
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
      const wallet = await this.dbReader.wallets.findByUserId(params.userId);
      if (!wallet) {
        return {
          success: false,
          error: '用户钱包不存在'
        };
      }

      if (wallet.wallet_type !== 'user') {
        return {
          success: false,
          error: '只有用户钱包才能提现'
        };
      }

      // 3. 查找代币信息
      const tokenInfo = await this.dbReader.getConnection().findTokenBySymbol(params.tokenSymbol, params.chainId);
      console.log('🔍 代币信息查询结果:', tokenInfo);
      if (!tokenInfo) {
        return {
          success: false,
          error: `不支持的代币: ${params.tokenSymbol}`
        };
      }

      // 4. 将用户输入的金额转换为最小单位
      const requestedAmountBigInt = BigInt(Math.floor(parseFloat(params.amount) * Math.pow(10, tokenInfo.decimals)));
      
      // 5. 检查最小提现金额
      const minWithdrawAmount = (tokenInfo as any).min_withdraw_amount || '0';
      console.log('🔍 最小提现金额验证:', {
        tokenSymbol: params.tokenSymbol,
        requestedAmount: params.amount,
        requestedAmountBigInt: requestedAmountBigInt.toString(),
        minWithdrawAmount,
        tokenInfo: tokenInfo
      });
      
      if (requestedAmountBigInt < BigInt(minWithdrawAmount)) {
        const minAmountFormatted = (BigInt(minWithdrawAmount) / BigInt(Math.pow(10, tokenInfo.decimals))).toString();
        console.log('❌ 提现金额小于最小提现金额:', {
          requested: requestedAmountBigInt.toString(),
          minRequired: minWithdrawAmount,
          minFormatted: minAmountFormatted
        });
        return {
          success: false,
          error: `提现金额不能小于最小提现金额 ${minAmountFormatted} ${params.tokenSymbol}`
        };
      }
      
      console.log('✅ 最小提现金额验证通过');
      
      // 6. 获取提现费用并计算实际转账金额
      const withdrawFee = (tokenInfo as any).withdraw_fee || '0';
      const actualAmount = requestedAmountBigInt - BigInt(withdrawFee);
      
      // 7. 检查用户余额是否充足（包含费用）
      const balanceCheck = await this.balanceService.checkSufficientBalance(
        params.userId,
        tokenInfo.id,
        requestedAmountBigInt.toString()
      );

      if (!balanceCheck.sufficient) {
        return {
          success: false,
          error: `用户余额不足。可用余额: ${(BigInt(balanceCheck.availableBalance) / BigInt(Math.pow(10, tokenInfo.decimals))).toString()} ${params.tokenSymbol}`
        };
      }

      // 8. 检查 signer 模块是否可用
      const isSignerHealthy = await this.signerService.checkHealth();
      if (!isSignerHealthy) {
        return {
          success: false,
          error: 'Signer 模块不可用，请稍后再试'
        };
      }

      // 9. 创建提现记录（状态：user_withdraw_request）
      const withdrawId = await this.dbGatewayService.createWithdrawRequest({
        user_id: params.userId,
        to_address: params.to,
        token_id: tokenInfo.id,
        amount: requestedAmountBigInt.toString(),
        fee: withdrawFee,
        chain_id: params.chainId,
        chain_type: params.chainType,
        status: 'user_withdraw_request'
      });



      // 10. 选择热钱包
      let gasEstimation;
      let hotWallet: {
        address: string;
        nonce: number;
        device?: string;
        userId: number;
      };
      
      try {
        // 选择合适的热钱包
        const walletSelection = await this.selectHotWallet({
          chainId: params.chainId,
          chainType: params.chainType,
          requiredAmount: normalizeBigIntString(actualAmount.toString()),
          tokenId: tokenInfo.id
        });

        if (!walletSelection.success) {
          return {
            success: false,
            error: walletSelection.error || '选择热钱包失败'
          };
        }

        hotWallet = walletSelection.wallet!;
        
        // 更新提现状态为 signing（填充 from 地址等信息）
        await this.dbGatewayService.updateWithdrawStatus(withdrawId, 'signing', {
          from_address: hotWallet.address,
          nonce: hotWallet.nonce
        });

        // 8. 使用选中钱包重新估算 gas 费用（确保准确性）
        if (tokenInfo.is_native) {
          gasEstimation = await this.gasEstimationService.estimateGas({
            chainId: params.chainId,
            gasLimit: 21000n // ETH 转账的标准 gas
          });
        } else {
          gasEstimation = await this.gasEstimationService.estimateGas({
            chainId: params.chainId,
            gasLimit: 60000n // ERC20 转账的配置 gas 限制， TODO: 需要根据代币类型调整
          });
        }
      } catch (error) {
        // 更新提现状态为失败
        await this.dbGatewayService.updateWithdrawStatus(withdrawId, 'failed', {
          error_message: `选择热钱包或获取 nonce 失败: ${error instanceof Error ? error.message : '未知错误'}`
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
        nonce: hotWallet.nonce,
        chainId: params.chainId,
        chainType: params.chainType,
        type: 2
      };

      // 只有非原生代币才设置 tokenAddress
      if (!tokenInfo.is_native && tokenInfo.token_address) {
        signRequest.tokenAddress = tokenInfo.token_address;
      }

      // 11. 请求 Signer 签名交易
      console.log('🔐 WalletBusinessService: 准备调用Signer签名');
      console.log('📤 发送给Signer的请求参数:', JSON.stringify(signRequest, null, 2));
      
      let signResult;
      try {
        signResult = await this.signerService.signTransaction(signRequest);
        console.log('✅ 签名成功，交易哈希:', signResult.transactionHash);
      } catch (error) {
        console.error('❌ WalletBusinessService: 捕获到签名异常:');
        console.error('📍 异常详情:', error);
        
        const errorMessage = error instanceof Error ? error.message : (error ? String(error) : '签名失败 - 未知错误');
        console.error('📄 处理后的错误消息:', errorMessage);
        
        // 更新提现状态为失败
        await this.dbGatewayService.updateWithdrawStatus(withdrawId, 'failed', {
          error_message: `签名失败: ${errorMessage}`
        });
        
        return {
          success: false,
          error: `签名失败: ${errorMessage}`
        };
      }

      // 12. 发送交易到区块链网络
      let txHash: string;
      try {
        // 根据chainId确定链类型
        const chain = this.getChainByChainId(params.chainId);
        const publicClient = this.getPublicClient(chain);
        
        // 发送已签名的交易
        txHash = await publicClient.sendRawTransaction({
          serializedTransaction: signResult.signedTransaction as `0x${string}`
        });
        
        console.log(`交易已发送到网络，交易哈希: ${txHash}`);
        
        // 标记nonce已使用
        await this.hotWalletService.markNonceUsed(hotWallet.address, params.chainId, hotWallet.nonce);
      
        // 测试交易是否成功
        // const receipt: TransactionReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        // console.log('交易状态:', receipt.status === 'success' ? '成功' : '失败')
        // console.log('区块号:', receipt.blockNumber)
        // console.log('Gas 使用量:', receipt.gasUsed.toString())
      
      
      } catch (error) {
        console.error('发送交易失败:', error);
        
        // 更新提现状态为失败
        await this.dbGatewayService.updateWithdrawStatus(withdrawId, 'failed', {
          error_message: `发送交易失败: ${error instanceof Error ? error.message : String(error)}`
        });
        
        return {
          success: false,
          error: `发送交易失败: ${error instanceof Error ? error.message : String(error)}`
        };
      }

      // 13. 更新提现状态为 pending，使用实际的交易哈希
      await this.dbGatewayService.updateWithdrawStatus(withdrawId, 'pending', {
        tx_hash: txHash, // 使用发送交易后返回的真实哈希
        gas_price: gasEstimation.gasPrice,
        max_fee_per_gas: gasEstimation.maxFeePerGas,
        max_priority_fee_per_gas: gasEstimation.maxPriorityFeePerGas
      });

      // 14. 创建 credit 流水记录（扣除用户余额）
      await this.dbGatewayService.createCredit({
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

      // 15. 创建热钱包 credit 流水记录（热钱包支出）
      await this.dbGatewayService.createCredit({
        user_id: hotWallet.userId,
        token_id: tokenInfo.id,
        token_symbol: params.tokenSymbol,
        amount: `-${actualAmount.toString()}`,
        chain_id: params.chainId,
        chain_type: params.chainType,
        reference_id: withdrawId,
        reference_type: 'withdraw',
        address: hotWallet.address,
        credit_type: 'withdraw',
        business_type: 'withdraw',
        status: 'pending'
      });

      return {
        success: true,
        data: {
          signedTransaction: signResult.signedTransaction,
          transactionHash: txHash, // 使用实际发送的交易哈希
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
          await this.dbGatewayService.updateWithdrawStatus(withdrawId, 'failed', {
            error_message: error instanceof Error ? error.message : '提现失败'
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
