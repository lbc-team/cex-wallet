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
   * 获取 signer 模块已生成的地址列表
   */
  async getGeneratedAddresses(): Promise<AddressListResponse> {
    try {
      const response: AxiosResponse<SignerApiResponse<AddressListResponse>> = await axios.get(
        `${this.signerBaseUrl}/api/signer/addresses`,
        {
          timeout: 5000 // 5秒超时
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || '获取地址列表失败');
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
      throw new Error(`获取地址列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
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
}
