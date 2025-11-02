import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { address } from '@solana/addresses';

/**
 * 计算 ATA (Associated Token Account) 地址
 * @param ownerAddress 钱包地址 (owner)
 * @param mintAddress Token Mint 地址
 * @returns ATA 地址
 */
export async function getAssociatedTokenAddress(ownerAddress: string, mintAddress: string): Promise<string> {
  try {
    const [ataAddress] = await findAssociatedTokenPda({
      owner: address(ownerAddress),
      mint: address(mintAddress),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    return ataAddress;
  } catch (error) {
    throw new Error(`计算 ATA 地址失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 批量计算 ATA 地址
 * @param ownerAddress 钱包地址
 * @param mintAddresses Token Mint 地址列表
 * @returns ATA 地址映射 { mintAddress: ataAddress }
 */
export async function getBatchAssociatedTokenAddresses(
  ownerAddress: string,
  mintAddresses: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const mintAddress of mintAddresses) {
    try {
      result[mintAddress] = await getAssociatedTokenAddress(ownerAddress, mintAddress);
    } catch (error) {
      console.error(`计算 ${mintAddress} 的 ATA 失败:`, error);
    }
  }

  return result;
}
