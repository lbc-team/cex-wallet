import { chainConfigManager } from '../../utils/chains';
import { GasEstimationService } from '../../utils/gasEstimation';
import { HotWalletService } from '../hotWalletService';
import {
  IWithdrawHandler,
  WithdrawContext,
  GasEstimationResult,
  TransactionParams,
  SignRequest
} from './types';

/**
 * EVM 链提现处理器
 */
export class EvmWithdrawHandler implements IWithdrawHandler {
  private gasEstimationService: GasEstimationService;
  private hotWalletService: HotWalletService;

  constructor(
    gasEstimationService: GasEstimationService,
    hotWalletService: HotWalletService
  ) {
    this.gasEstimationService = gasEstimationService;
    this.hotWalletService = hotWalletService;
  }

  async estimateGas(context: WithdrawContext, tokenInfo: any): Promise<GasEstimationResult> {
    // EVM 链：使用 gas 估算服务
    if (tokenInfo.is_native) {
      return await this.gasEstimationService.estimateGas({
        chainId: context.chainId,
        gasLimit: BigInt(21000) // ETH 转账的标准 gas
      });
    } else {
      return await this.gasEstimationService.estimateGas({
        chainId: context.chainId,
        gasLimit: BigInt(60000) // ERC20 转账的配置 gas 限制
      });
    }
  }

  async prepareTransactionParams(context: WithdrawContext, tokenInfo: any): Promise<TransactionParams> {
    // EVM 链：获取 gas 估算
    const gasEstimation = await this.estimateGas(context, tokenInfo);
    return { gasEstimation };
  }

  buildSignRequest(
    context: WithdrawContext,
    transactionParams: TransactionParams,
    tokenInfo: any
  ): SignRequest {
    const gasEstimation = transactionParams.gasEstimation!;

    const signRequest: SignRequest = {
      address: context.hotWallet.address,
      to: context.to,
      amount: context.actualAmount.toString(),
      ...(gasEstimation.gasLimit && { gas: gasEstimation.gasLimit }),
      ...(gasEstimation.maxFeePerGas && { maxFeePerGas: gasEstimation.maxFeePerGas }),
      ...(gasEstimation.maxPriorityFeePerGas && { maxPriorityFeePerGas: gasEstimation.maxPriorityFeePerGas }),
      nonce: context.hotWallet.nonce,
      chainId: context.chainId,
      chainType: 'evm',
      type: 2, // 使用 EIP-1559
      tokenType: tokenInfo.token_type || (tokenInfo.is_native ? 'native' : 'erc20')
    };

    // 只有非原生代币才设置 tokenAddress
    if (!tokenInfo.is_native && tokenInfo.token_address) {
      signRequest.tokenAddress = tokenInfo.token_address;
    }

    return signRequest;
  }

  async sendTransaction(
    signedTransaction: string,
    context: WithdrawContext
  ): Promise<string> {
    const chain = chainConfigManager.getChainByChainId(context.chainId);
    const publicClient = chainConfigManager.getPublicClient(chain);

    // 发送已签名的交易
    const txHash = await publicClient.sendRawTransaction({
      serializedTransaction: signedTransaction as `0x${string}`
    });

    console.log(`✅ EVM 交易已发送，哈希: ${txHash}`);

    return txHash;
  }

  async afterSendTransaction(
    txHash: string,
    context: WithdrawContext,
    transactionParams: TransactionParams
  ): Promise<void> {
    // 标记 nonce 已使用
    await this.hotWalletService.markNonceUsed(
      context.hotWallet.address,
      context.chainId,
      context.hotWallet.nonce
    );
  }
}
