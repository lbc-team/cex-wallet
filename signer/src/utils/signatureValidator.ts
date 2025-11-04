import * as nacl from 'tweetnacl';

/**
 * 签名验证工具类
 */
export class SignatureValidator {
  /**
   * 将十六进制字符串转换为 Uint8Array
   */
  private static hexToUint8Array(hex: string): Uint8Array {
    if (hex.startsWith('0x')) {
      hex = hex.slice(2);
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  /**
   * 验证签名
   * @param message 原始消息
   * @param signatureHex 签名（十六进制字符串）
   * @param publicKeyHex 公钥（十六进制字符串）
   * @returns 验证是否通过
   */
  public static verify(message: string, signatureHex: string, publicKeyHex: string): boolean {
    try {
      const messageBytes = new TextEncoder().encode(message);
      const signature = this.hexToUint8Array(signatureHex);
      const publicKey = this.hexToUint8Array(publicKeyHex);

      const isValid = nacl.sign.detached.verify(messageBytes, signature, publicKey);
      
      if (!isValid) {
        console.error('❌ 签名验证失败');
        console.error('消息:', message);
        console.error('签名:', signatureHex);
        console.error('公钥:', publicKeyHex);
      }
      
      return isValid;
    } catch (error) {
      console.error('签名验证异常:', error);
      console.error('消息:', message);
      console.error('签名:', signatureHex);
      return false;
    }
  }

  private static buildSignaturePayload(params: {
    operationId: string;
    chainType: 'evm' | 'btc' | 'solana';
    from: string;
    to: string;
    amount: string;
    tokenAddress?: string;
    tokenType?: string;
    chainId: number;
    nonce: number;
    blockhash?: string;
    lastValidBlockHeight?: string;
    fee?: string;
    timestamp: number;
  }): string {
    const payload = {
      operation_id: params.operationId,
      chainType: params.chainType,
      from: params.from,
      to: params.to,
      amount: params.amount,
      tokenAddress: params.tokenAddress ?? null,
      tokenType: params.tokenType ?? null,
      chainId: params.chainId,
      nonce: params.nonce,
      blockhash: params.blockhash ?? null,
      lastValidBlockHeight: params.lastValidBlockHeight ?? null,
      fee: params.fee ?? null,
      timestamp: params.timestamp
    };

    return JSON.stringify(payload);
  }

  /**
   * 验证风控签名
   */
  public static verifyRiskSignature(
    params: {
      operationId: string;
      chainType: 'evm' | 'btc' | 'solana';
      from: string;
      to: string;
      amount: string;
      tokenAddress?: string;
      tokenType?: string;
      chainId: number;
      nonce: number;
      blockhash?: string;
      lastValidBlockHeight?: string;
      fee?: string;
      timestamp: number;
    },
    riskSignature: string,
    riskPublicKey: string
  ): boolean {
    // 构造签名负载（与 risk_control 服务一致）
    const payload = this.buildSignaturePayload(params);
    
    console.log('🔍 Signer 风控验证载荷:', payload);

    return this.verify(payload, riskSignature, riskPublicKey);
  }

  /**
   * 验证 wallet 服务签名
   */
  public static verifyWalletSignature(
    params: {
      operationId: string;
      chainType: 'evm' | 'btc' | 'solana';
      from: string;
      to: string;
      amount: string;
      tokenAddress?: string;
      tokenType?: string;
      chainId: number;
      nonce: number;
      blockhash?: string;
      lastValidBlockHeight?: string;
      fee?: string;
      timestamp: number;
    },
    walletSignature: string,
    walletPublicKey: string
  ): boolean {
    // 构造签名负载（与 wallet 服务一致）
    const payload = this.buildSignaturePayload(params);
    
    console.log('🔍 Signer Wallet 验证载荷:', payload);

    return this.verify(payload, walletSignature, walletPublicKey);
  }
}
