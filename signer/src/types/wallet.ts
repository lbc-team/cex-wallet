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

