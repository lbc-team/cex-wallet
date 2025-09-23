import axios, { AxiosResponse } from 'axios';

// Signer 模块的响应接口
interface SignerApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

// 创建钱包请求
interface CreateWalletRequest {
  chainType: 'evm' | 'btc' | 'solana';
}

// 钱包数据
interface WalletData {
  address: string;
  privateKey: string;
  device: string;
  path: string;
  chainType: 'evm' | 'btc' | 'solana';
  createdAt: string;
  updatedAt: string;
}

// 交易签名请求
interface SignTransactionRequest {
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
  
  nonce?: number;        // 交易nonce（可选）
  type?: 0 | 2;         // 交易类型：0=Legacy, 2=EIP-1559（可选，默认为2）
}

// 交易签名响应数据
interface SignTransactionData {
  signedTransaction: string; // 签名后的交易数据
  transactionHash: string;   // 交易哈希
}

// 地址信息
interface AddressInfo {
  address: string;
  path: string;
  index: number;
}

// 地址列表响应
interface AddressListResponse {
  addresses: AddressInfo[];
  currentIndex: number;
  total: number;
}

export class SignerService {
  private signerBaseUrl: string;

  constructor() {
    this.signerBaseUrl = process.env.SIGNER_BASE_URL || 'http://localhost:3001';
  }

  /**
   * 向 signer 模块请求创建新钱包
   */
  async createWallet(chainType: 'evm' | 'btc' | 'solana'): Promise<WalletData> {
    try {
      const requestData: CreateWalletRequest = {
        chainType
      };

      const response: AxiosResponse<SignerApiResponse<WalletData>> = await axios.post(
        `${this.signerBaseUrl}/api/signer/create`,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10秒超时
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || '创建钱包失败');
      }

      if (!response.data.data) {
        throw new Error('Signer 模块返回的数据为空');
      }

      return response.data.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          throw new Error(`Signer 模块错误: ${error.response.data?.error || error.message}`);
        } else if (error.request) {
          throw new Error('无法连接到 Signer 模块');
        }
      }
      throw new Error(`创建钱包失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }


  /**
   * 检查 signer 模块是否可用
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.signerBaseUrl}/health`, {
        timeout: 3000 // 3秒超时
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * 请求 Signer 模块签名交易
   */
  async signTransaction(request: SignTransactionRequest): Promise<SignTransactionData> {
    try {
      const response: AxiosResponse<SignerApiResponse<SignTransactionData>> = await axios.post(
        `${this.signerBaseUrl}/api/signer/sign-transaction`,
        request,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30秒超时，签名可能需要更长时间
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || '签名交易失败');
      }

      if (!response.data.data) {
        throw new Error('Signer 模块返回的数据为空');
      }

      return response.data.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          throw new Error(`Signer 模块错误: ${error.response.data?.error || error.message}`);
        } else if (error.request) {
          throw new Error('无法连接到 Signer 模块');
        }
      }
      throw new Error(`签名交易失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }
}
