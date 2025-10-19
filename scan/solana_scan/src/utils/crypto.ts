import * as nacl from 'tweetnacl';

export interface SignaturePayload {
  operation_id: string;
  operation_type: string;
  table: string;
  action: string;
  data: any;
  conditions: any;
  timestamp: number;
}

export class Ed25519Signer {
  private secretKey: Uint8Array;
  private publicKey: Uint8Array;

  constructor() {
    // 从环境变量读取私钥，或者生成新的密钥对
    const privateKeyHex = process.env.DB_GATEWAY_SECRET;

    if (privateKeyHex) {
      // 从十六进制字符串解析私钥
      this.secretKey = this.hexToUint8Array(privateKeyHex);
      // 从私钥提取公钥（Ed25519 私钥是 64 字节，后 32 字节是公钥）
      this.publicKey = this.secretKey.slice(32, 64);
    } else {
      // 生成新密钥对
      const keyPair = nacl.sign.keyPair();
      this.secretKey = keyPair.secretKey;
      this.publicKey = keyPair.publicKey;

      console.warn('警告: DB_GATEWAY_SECRET 未配置，已生成临时密钥对');
      console.warn('公钥 (hex):', this.uint8ArrayToHex(this.publicKey));
      console.warn('私钥 (hex):', this.uint8ArrayToHex(this.secretKey));
    }
  }

  /**
   * 对数据进行签名
   */
  sign(payload: SignaturePayload): string {
    // 对 payload 进行规范化排序并序列化
    const message = this.serializePayload(payload);
    const messageBytes = new TextEncoder().encode(message);

    // 使用 Ed25519 签名
    const signature = nacl.sign.detached(messageBytes, this.secretKey);

    // 返回十六进制格式的签名
    return this.uint8ArrayToHex(signature);
  }

  /**
   * 验证签名
   */
  verify(payload: SignaturePayload, signatureHex: string, publicKeyHex: string): boolean {
    const message = this.serializePayload(payload);
    const messageBytes = new TextEncoder().encode(message);
    const signature = this.hexToUint8Array(signatureHex);
    const publicKey = this.hexToUint8Array(publicKeyHex);

    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  }

  /**
   * 序列化 payload 为字符串
   * 必须与 db_gateway 使用的顺序保持一致
   */
  private serializePayload(payload: SignaturePayload): string {
    return JSON.stringify({
      operation_id: payload.operation_id,
      operation_type: payload.operation_type,
      table: payload.table,
      action: payload.action,
      data: payload.data ?? null,
      conditions: payload.conditions ?? null,
      timestamp: payload.timestamp
    });
  }

  /**
   * 将 Uint8Array 转换为十六进制字符串
   */
  private uint8ArrayToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * 将十六进制字符串转换为 Uint8Array
   */
  private hexToUint8Array(hex: string): Uint8Array {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) {
      throw new Error('Invalid hex string');
    }
    return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
  }

  /**
   * 获取公钥（十六进制格式）
   */
  getPublicKeyHex(): string {
    return this.uint8ArrayToHex(this.publicKey);
  }
}
