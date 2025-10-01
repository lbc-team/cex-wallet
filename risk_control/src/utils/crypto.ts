import * as nacl from 'tweetnacl';
import { SignaturePayload } from '../types';

export class Ed25519Signer {
  private privateKey: Uint8Array;
  private publicKey: Uint8Array;

  constructor(privateKeyHex?: string) {
    if (privateKeyHex) {
      this.privateKey = this.hexToUint8Array(privateKeyHex);
      // Ed25519 私钥的后32字节是公钥
      this.publicKey = this.privateKey.slice(32, 64);
    } else {
      // 如果没有提供私钥，生成新的密钥对
      const keyPair = nacl.sign.keyPair();
      this.privateKey = keyPair.secretKey;
      this.publicKey = keyPair.publicKey;
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

  /**
   * 创建签名负载的JSON字符串
   */
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

  /**
   * 对签名负载进行签名
   */
  public sign(payload: SignaturePayload): string {
    const messageString = this.createSignaturePayload(payload);
    const messageBytes = new TextEncoder().encode(messageString);
    const signature = nacl.sign.detached(messageBytes, this.privateKey);
    return this.uint8ArrayToHex(signature);
  }

  /**
   * 对任意字符串进行签名
   */
  public signMessage(message: string): string {
    const messageBytes = new TextEncoder().encode(message);
    const signature = nacl.sign.detached(messageBytes, this.privateKey);
    return this.uint8ArrayToHex(signature);
  }

  /**
   * 获取公钥（16进制字符串）
   */
  public getPublicKeyHex(): string {
    return this.uint8ArrayToHex(this.publicKey);
  }

  /**
   * 获取私钥（16进制字符串）- 仅用于开发/测试
   */
  public getPrivateKeyHex(): string {
    return this.uint8ArrayToHex(this.privateKey);
  }

  /**
   * 生成新的密钥对
   */
  public static generateKeyPair(): { publicKey: string; privateKey: string } {
    const keyPair = nacl.sign.keyPair();
    const signer = new Ed25519Signer();
    return {
      publicKey: signer.uint8ArrayToHex(keyPair.publicKey),
      privateKey: signer.uint8ArrayToHex(keyPair.secretKey)
    };
  }
}
