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

    if (walletPublicKey) {
      this.modulePublicKeys.set('wallet', this.hexToUint8Array(walletPublicKey));
    }

    if (scanPublicKey) {
      this.modulePublicKeys.set('scan', this.hexToUint8Array(scanPublicKey));
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
      timestamp: payload.timestamp,
      module: payload.module
    });
  }

  public verifySignature(
    payload: SignaturePayload,
    signature: string,
    module: 'wallet' | 'scan'
  ): boolean {
    try {
      const publicKey = this.modulePublicKeys.get(module);
      if (!publicKey) {
        console.error(`Public key not found for module: ${module}`);
        return false;
      }

      // 创建签名payload
      const messageString = this.createSignaturePayload(payload);
      const message = new TextEncoder().encode(messageString);

      // 解析签名
      const signatureBytes = this.hexToUint8Array(signature);

      // 验证签名
      const isValid = nacl.sign.detached.verify(message, signatureBytes, publicKey);

      console.log(`Signature verification for ${module}:`, {
        payload: messageString,
        signature: signature,
        isValid
      });

      return isValid;
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
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