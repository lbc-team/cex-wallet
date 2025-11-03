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

  // EVM 特定字段
  tokenAddress?: string;  // ERC20代币合约地址（可选，为空则为ETH转账）
  gas?: string;          // Gas限制（可选）
  maxFeePerGas?: string;        // 最大费用（包含基础费用和优先费用）
  maxPriorityFeePerGas?: string; // 最大优先费用（矿工小费）
  gasPrice?: string;     // Gas价格（仅用于 Legacy 交易）
  nonce?: number;         // 交易nonce（EVM 必需）
  type?: 0 | 2;         // 交易类型：0=Legacy, 2=EIP-1559（可选，默认为2）

  // Solana 特定字段
  tokenMint?: string;    // SPL Token Mint 地址（可选，为空则为 SOL 转账）
  blockhash?: string;    // Solana blockhash（Solana 必需）
  fee?: string;          // Solana 交易费用（lamports）

  // 通用字段
  chainId: number;       // 链ID（必需）
  chainType: 'evm' | 'btc' | 'solana'; // 链类型（必需）

  // 双重签名验证参数（必需）
  operation_id: string;      // 操作ID
  timestamp: number;         // 时间戳
  risk_signature: string;    // 风控签名
  wallet_signature: string;  // Wallet服务签名
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

