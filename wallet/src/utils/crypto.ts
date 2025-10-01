import * as nacl from 'tweetnacl';

export interface SignaturePayload {
  operation_id: string;
  operation_type: string;
  table: string;
  action: string;
  data?: any;
  conditions?: any;
  timestamp: number;
}

export class Ed25519Signer {
  private privateKey: Uint8Array;
  private publicKey: Uint8Array;

  constructor(privateKeyHex?: string) {
    if (privateKeyHex) {
      this.privateKey = this.hexToUint8Array(privateKeyHex);
      // 从私钥提取公钥（tweetnacl的私钥是64字节，后32字节是公钥）
      this.publicKey = this.privateKey.slice(32, 64);
    } else {
      // 从环境变量加载
      const privateKeyFromEnv = process.env.WALLET_PRIVATE_KEY;
      if (!privateKeyFromEnv) {
        throw new Error('WALLET_PRIVATE_KEY not found in environment variables');
      }
      this.privateKey = this.hexToUint8Array(privateKeyFromEnv);
      this.publicKey = this.privateKey.slice(32, 64);
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
    });
  }

  public sign(payload: SignaturePayload): string {
    const messageString = this.createSignaturePayload(payload);
    const messageBytes = new TextEncoder().encode(messageString);
    const signature = nacl.sign.detached(messageBytes, this.privateKey);
    return this.uint8ArrayToHex(signature);
  }

  public getPublicKeyHex(): string {
    return this.uint8ArrayToHex(this.publicKey);
  }

  public static generateKeyPair(): { publicKey: string; privateKey: string } {
    const keyPair = nacl.sign.keyPair();
    return {
      publicKey: Array.from(keyPair.publicKey)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
      privateKey: Array.from(keyPair.secretKey)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    };
  }
}