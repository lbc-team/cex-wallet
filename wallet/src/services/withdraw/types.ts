/**
 * 提现处理器通用类型定义
 */

export interface WithdrawParams {
  userId: number;
  to: string;
  amount: string;
  tokenSymbol: string;
  chainId: number;
  chainType: 'evm' | 'btc' | 'solana';
}

export interface WithdrawContext {
  userId: number;
  to: string;
  amount: string;
  tokenSymbol: string;
  chainId: number;
  chainType: 'evm' | 'btc' | 'solana';
  tokenInfo: any;
  requestedAmountBigInt: bigint;
  withdrawFee: string;
  actualAmount: bigint;
  withdrawId: number;
  hotWallet: {
    address: string;
    nonce: number;
    device?: string;
    userId: number;
  };
}

export interface GasEstimationResult {
  // EVM 相关
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
  networkCongestion?: 'low' | 'medium' | 'high';
  // Solana 相关
  fee?: string;
}

export interface TransactionParams {
  // EVM 相关
  gasEstimation?: GasEstimationResult;
  // Solana 相关
  blockhash?: string;
  lastValidBlockHeight?: string;
  fee?: string;
}

export interface SignRequest {
  address: string;
  to: string;
  amount: string;
  tokenAddress?: string;
  chainId: number;
  chainType: 'evm' | 'btc' | 'solana';
  tokenType?: string;
  // EVM 特有
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
  type?: 0 | 2;  // 交易类型：0=Legacy, 2=EIP-1559
  // Solana 特有
  blockhash?: string;
  lastValidBlockHeight?: string;
  
  fee?: string;
}

export interface WithdrawResult {
  success: boolean;
  data?: {
    signedTransaction: string;
    transactionHash: string;
    withdrawAmount: string;
    actualAmount: string;
    fee: string;
    withdrawId: number;
    gasEstimation: {
      gasLimit?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      networkCongestion?: 'low' | 'medium' | 'high';
    };
  };
  error?: string;
  errorDetail?: string;
}

/**
 * 提现处理器接口
 * 每个链类型需要实现这个接口
 */
export interface IWithdrawHandler {
  /**
   * 估算交易费用
   */
  estimateGas(context: WithdrawContext, tokenInfo: any): Promise<GasEstimationResult>;

  /**
   * 准备交易参数（如 Solana 的 blockhash）
   */
  prepareTransactionParams(context: WithdrawContext, tokenInfo: any): Promise<TransactionParams>;

  /**
   * 构建签名请求
   */
  buildSignRequest(
    context: WithdrawContext,
    transactionParams: TransactionParams,
    tokenInfo: any
  ): SignRequest;

  /**
   * 发送交易到区块链网络
   */
  sendTransaction(
    signedTransaction: string,
    context: WithdrawContext
  ): Promise<string>;

  /**
   * 发送交易后的清理工作（如标记 nonce 已使用）
   */
  afterSendTransaction(
    txHash: string,
    context: WithdrawContext,
    transactionParams: TransactionParams
  ): Promise<void>;
}
