import * as nacl from 'tweetnacl';
import { SignaturePayload } from '../types';

export class Ed25519Verifier {
  private modulePublicKeys: Map<string, Uint8Array> = new Map();

  constructor() {
    this.loadPublicKeys();
  }

  private loadPublicKeys() {
    const walletPublicKey = process.env.WALLET_PUBLIC_KEY;
    const scanPublicKey = process.env.SCAN_PUBLIC_KEY;
    const riskPublicKey = process.env.RISK_PUBLIC_KEY;

    if (walletPublicKey) {
      this.modulePublicKeys.set('wallet', this.hexToUint8Array(walletPublicKey));
    }

    if (scanPublicKey) {
      this.modulePublicKeys.set('scan', this.hexToUint8Array(scanPublicKey));
    }

    if (riskPublicKey) {
      this.modulePublicKeys.set('risk', this.hexToUint8Array(riskPublicKey));
    }
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

  public createSignaturePayload(payload: SignaturePayload): string {
    return JSON.stringify({
      operation_id: payload.operation_id,
      operation_type: payload.operation_type,
      table: payload.table,
      action: payload.action,
      data: payload.data || null,
      conditions: payload.conditions || null,
      timestamp: payload.timestamp
      // module 字段已移除
    });
  }

  /**
   * 验证签名并自动识别签名者
   * @param payload 签名负载
   * @param signature 签名（十六进制字符串）
   * @returns { valid: boolean, signer?: string } 验证结果和签名者
   */
  public verifySignature(
    payload: SignaturePayload,
    signature: string
  ): { valid: boolean; signer?: string } {
    try {
      // 创建签名payload
      const messageString = this.createSignaturePayload(payload);
      const message = new TextEncoder().encode(messageString);

      // 解析签名
      const signatureBytes = this.hexToUint8Array(signature);

      // 尝试所有已知的公钥 TODO: 根据 IP 地址判断可用的公钥
      for (const [moduleName, publicKey] of this.modulePublicKeys.entries()) {
        const isValid = nacl.sign.detached.verify(message, signatureBytes, publicKey);

        if (isValid) {
          console.log(`Signature verified successfully, signer: ${moduleName}`, {
            payload: messageString,
            signature: signature.substring(0, 16) + '...'
          });
          return { valid: true, signer: moduleName };
        }
      }

      console.warn('Signature verification failed - no matching public key found', {
        payload: messageString,
        signature: signature.substring(0, 16) + '...',
        availableModules: Array.from(this.modulePublicKeys.keys())
      });

      return { valid: false };
    } catch (error) {
      console.error('Signature verification error:', error);
      return { valid: false };
    }
  }

  public generateKeyPair(): { publicKey: string; privateKey: string } {
    const keyPair = nacl.sign.keyPair();
    return {
      publicKey: this.uint8ArrayToHex(keyPair.publicKey),
      privateKey: this.uint8ArrayToHex(keyPair.secretKey)
    };
  }

  public signMessage(message: string, privateKeyHex: string): string {
    const privateKey = this.hexToUint8Array(privateKeyHex);
    const messageBytes = new TextEncoder().encode(message);
    const signature = nacl.sign.detached(messageBytes, privateKey);
    return this.uint8ArrayToHex(signature);
  }

  public hasPublicKey(module: string): boolean {
    return this.modulePublicKeys.has(module);
  }

  public getPublicKeyHex(module: string): string | null {
    const publicKey = this.modulePublicKeys.get(module);
    return publicKey ? this.uint8ArrayToHex(publicKey) : null;
  }
}