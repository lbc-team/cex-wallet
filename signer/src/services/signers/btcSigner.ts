import { SignTransactionResponse } from '../../types/wallet';

export async function signBtcTransaction(): Promise<SignTransactionResponse> {
  console.error('❌ Bitcoin 链签名功能尚未实现');
  return {
    success: false,
    error: 'Bitcoin 链签名功能尚未实现'
  };
}
