// Token 相关功能从 @solana-program/token 导入（@solana/kit 不包含 Token 程序）
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
// 通用功能从 @solana/kit 导入
import { address } from '@solana/kit';

// Token2022 程序地址
const TOKEN_2022_PROGRAM_ADDRESS = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

/**
 * 计算 ATA (Associated Token Account) 地址
 * @param ownerAddress 钱包地址 (owner)
 * @param mintAddress Token Mint 地址
 * @param tokenType 代币类型：'spl-token' | 'spl-token-2022'，默认为 'spl-token'
 * @returns ATA 地址
 */
export async function getAssociatedTokenAddress(
  ownerAddress: string,
  mintAddress: string,
  tokenType: 'spl-token' | 'spl-token-2022' = 'spl-token'
): Promise<string> {
  try {
    // 根据 tokenType 选择正确的程序地址
    const tokenProgramAddress = tokenType === 'spl-token-2022' ? TOKEN_2022_PROGRAM_ADDRESS : TOKEN_PROGRAM_ADDRESS;

    const [ataAddress] = await findAssociatedTokenPda({
      owner: address(ownerAddress),
      mint: address(mintAddress),
      tokenProgram: tokenProgramAddress,
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
