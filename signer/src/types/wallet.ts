// 钱包类型定义
export interface Wallet {
  id?: number;
  address: string;
  // privateKey: string;  不存储私钥
  device: string;
  path: string;
  chainType: 'evm' | 'btc' | 'solana';
  createdAt?: string;
  updatedAt?: string;
}

// 钱包创建响应
export interface CreateWalletResponse {
  success: boolean;
  data?: Wallet;
  error?: string;
}


// 密钥派生路径
export interface DerivationPath {
  evm: string;    // 以太坊路径
  btc: string;    // 比特币路径
  solana: string; // Solana路径
}

// 交易签名请求
export interface SignTransactionRequest {
  address: string;         // 发送方地址
  to: string;             // 接收方地址
  amount: string;         // 转账金额（最小单位）
  tokenAddress?: string;  // ERC20代币合约地址（可选，为空则为ETH转账）
  gas?: string;          // Gas限制（可选）
  
  // EIP-1559 gas 参数（推荐使用）
  maxFeePerGas?: string;        // 最大费用（包含基础费用和优先费用）
  maxPriorityFeePerGas?: string; // 最大优先费用（矿工小费）
  
  // Legacy gas 参数（向后兼容）
  gasPrice?: string;     // Gas价格（仅用于 Legacy 交易）
  
  nonce: number;         // 交易nonce（必需）
  chainId: number;       // 链ID（必需）
  chainType: 'evm' | 'btc' | 'solana'; // 链类型（必需）
  type?: 0 | 2;         // 交易类型：0=Legacy, 2=EIP-1559（可选，默认为2）
}

// 交易签名响应
export interface SignTransactionResponse {
  success: boolean;
  data?: {
    signedTransaction: string; // 签名后的交易数据
    transactionHash: string;   // 交易哈希
  };
  error?: string;
}

