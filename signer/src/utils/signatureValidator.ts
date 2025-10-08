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

      return nacl.sign.detached.verify(messageBytes, signature, publicKey);
    } catch (error) {
      console.error('签名验证异常:', error);
      return false;
    }
  }

  /**
   * 验证风控签名
   */
  public static verifyRiskSignature(
    operationId: string,
    from: string,
    to: string,
    amount: string,
    tokenAddress: string | undefined,
    chainId: number,
    nonce: number,
    timestamp: number,
    riskSignature: string,
    riskPublicKey: string
  ): boolean {
    // 构造签名负载（与 risk_control 服务一致）
    const payload = JSON.stringify({
      operation_id: operationId,
      from,
      to,
      amount,
      tokenAddress: tokenAddress || null,
      chainId,
      nonce,
      timestamp
    });

    return this.verify(payload, riskSignature, riskPublicKey);
  }

  /**
   * 验证 wallet 服务签名
   */
  public static verifyWalletSignature(
    operationId: string,
    from: string,
    to: string,
    amount: string,
    tokenAddress: string | undefined,
    chainId: number,
    nonce: number,
    timestamp: number,
    walletSignature: string,
    walletPublicKey: string
  ): boolean {
    // 构造签名负载（与 wallet 服务一致）
    const payload = JSON.stringify({
      operation_id: operationId,
      from,
      to,
      amount,
      tokenAddress: tokenAddress || null,
      chainId,
      nonce,
      timestamp
    });

    return this.verify(payload, walletSignature, walletPublicKey);
  }
}
