import axios, { AxiosResponse } from 'axios';
import * as nacl from 'tweetnacl';
import { v4 as uuidv4 } from 'uuid';
import { getRiskControlClient, TransactionSignRequest } from './riskControlClient';

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

  nonce: number;         // 交易nonce（必需）
  chainId: number;       // 链ID（必需）
  chainType: 'evm' | 'btc' | 'solana'; // 链类型（必需）
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

export class SignerClient {
  private signerBaseUrl: string;
  private privateKey: Uint8Array;
  private publicKey: Uint8Array;
  private riskControlClient = getRiskControlClient();

  constructor() {
    this.signerBaseUrl = process.env.SIGNER_BASE_URL || 'http://localhost:3001';

    // 从环境变量加载私钥
    const privateKeyHex = process.env.WALLET_PRIVATE_KEY;
    if (!privateKeyHex) {
      throw new Error('WALLET_PRIVATE_KEY 未配置');
    }

    this.privateKey = this.hexToUint8Array(privateKeyHex);
    this.publicKey = this.privateKey.slice(32, 64);
  }

  private hexToUint8Array(hex: string): Uint8Array {
    if (hex.startsWith('0x')) {
      hex = hex.slice(2);
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  private uint8ArrayToHex(array: Uint8Array): string {
    return Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * 对消息进行签名
   */
  private signMessage(message: string): string {
    const messageBytes = new TextEncoder().encode(message);
    const signature = nacl.sign.detached(messageBytes, this.privateKey);
    return this.uint8ArrayToHex(signature);
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
   * 请求 Signer 模块签名交易（带双重签名）
   */
  async signTransaction(request: SignTransactionRequest): Promise<SignTransactionData> {
    console.log('📥 SignerClient: 请求参数:', JSON.stringify(request, null, 2));

    try {
      // 1. 生成 operation_id 和 timestamp
      const operationId = uuidv4();
      const timestamp = Date.now();

      // 2. 请求风控签名
      console.log('🛡️ SignerClient: 请求风控签名...');
      const riskSignRequest: TransactionSignRequest = {
        operation_id: operationId,
        transaction: {
          from: request.address,
          to: request.to,
          amount: request.amount,
          ...(request.tokenAddress && { tokenAddress: request.tokenAddress }),
          chainId: request.chainId,
          nonce: request.nonce
        },
        timestamp
      };

      const riskSignResult = await this.riskControlClient.requestWithdrawRiskAssessment(riskSignRequest);

      // 检查风控决策
      if (riskSignResult.decision !== 'approve') {
        throw new Error(`风控拒绝交易: ${riskSignResult.decision}, 原因: ${riskSignResult.reasons?.join(', ')}`);
      }

      console.log('✅ SignerClient: 风控签名获取成功');

      // 3. 生成 wallet 服务自己的签名
      const signPayload = JSON.stringify({
        operation_id: operationId,
        from: request.address,
        to: request.to,
        amount: request.amount,
        tokenAddress: request.tokenAddress || null,
        chainId: request.chainId,
        nonce: request.nonce,
        timestamp
      });

      const walletSignature = this.signMessage(signPayload);
      console.log('✅ SignerClient: Wallet 服务签名生成成功');

      // 4. 请求 Signer 签名交易，携带双重签名
      console.log('🌐 SignerClient: 请求 Signer 服务签名交易');
      const response: AxiosResponse<SignerApiResponse<SignTransactionData>> = await axios.post(
        `${this.signerBaseUrl}/api/signer/sign-transaction`,
        {
          ...request,
          operation_id: operationId,
          timestamp,
          risk_signature: riskSignResult.risk_signature,
          wallet_signature: walletSignature
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log('📋 SignerClient: 响应状态:', response.status);

      if (!response.data.success) {
        const errorMsg = response.data.error || '签名交易失败';
        console.error('❌ SignerClient: 签名失败:', errorMsg);
        throw new Error(errorMsg);
      }

      if (!response.data.data) {
        throw new Error('Signer 模块返回的数据为空');
      }

      console.log('✅ SignerClient: 交易签名成功');
      return response.data.data;
    } catch (error) {
      console.error('❌ SignerClient: 请求异常:', error);

      if (axios.isAxiosError(error)) {
        if (error.response) {
          throw new Error(`Signer 模块错误: ${error.response.data?.error || error.message}`);
        } else if (error.request) {
          throw new Error('无法连接到 Signer 模块');
        }
      }

      const errorMessage = error instanceof Error ? error.message : '未知错误';
      throw new Error(`签名交易失败: ${errorMessage}`);
    }
  }

}
