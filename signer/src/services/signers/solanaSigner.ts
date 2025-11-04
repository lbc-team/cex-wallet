import { mnemonicToSeedSync } from '@scure/bip39';
import { derivePath } from 'ed25519-hd-key';
import {
  appendTransactionMessageInstruction,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  address as solanaAddress
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { findAssociatedTokenPda, getTransferInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import bs58 from 'bs58';
import { SignTransactionRequest, SignTransactionResponse } from '../../types/wallet';
import { DatabaseConnection } from '../../db/connection';

const TOKEN_PROGRAM_2022_ADDRESS = solanaAddress('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export interface SolanaSignerDependencies {
  db: DatabaseConnection;
  mnemonic: string;
  password: string;
}

export async function signSolanaTransaction(
  request: SignTransactionRequest,
  deps: SolanaSignerDependencies
): Promise<SignTransactionResponse> {
  const { db, mnemonic, password } = deps;

  console.log('💰 处理 Solana 链交易:', request.chainId, '代币:', request.tokenAddress || 'SOL');
  console.log('💵 转账金额:', request.amount);

  if (!request.blockhash) {
    console.error('❌ 缺少 Solana blockhash 参数');
    return {
      success: false,
      error: 'Solana 交易缺少 blockhash 参数'
    };
  }

  const solanaAddressInfo = await db.findAddressByAddress(request.address);
  if (!solanaAddressInfo) {
    const error = `地址 ${request.address} 未找到，请确保地址是通过此系统生成的`;
    console.error('❌ 地址查找失败:', error);
    return {
      success: false,
      error
    };
  }

  const solanaSeed = mnemonicToSeedSync(mnemonic, password);
  const solanaSeedHex = Buffer.from(solanaSeed).toString('hex');
  const derivedSeed = derivePath(solanaAddressInfo.path, solanaSeedHex).key;

  const solanaSigner = await createKeyPairSignerFromPrivateKeyBytes(derivedSeed);
  console.log('✅ Solana Signer 地址:', solanaSigner.address);
  console.log(
    '🔍 Solana Signer 对象:',
    JSON.stringify(
      {
        address: solanaSigner.address,
        hasSignMessages: typeof (solanaSigner as any).signMessages === 'function'
      },
      null,
      2
    )
  );

  if (solanaSigner.address !== request.address) {
    const error = 'Solana 地址验证失败，密码可能不正确';
    console.error('❌ 地址验证失败:');
    console.error('   生成的地址:', solanaSigner.address);
    console.error('   请求的地址:', request.address);
    return {
      success: false,
      error
    };
  }

  const instruction = await buildInstruction(request, solanaSigner);

  const lifetimeConstraint = {
    blockhash: request.blockhash as any,
    lastValidBlockHeight: request.lastValidBlockHeight ? BigInt(request.lastValidBlockHeight) : BigInt(99999999)
  };

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageFeePayerSigner(solanaSigner, tx),
    tx => setTransactionMessageLifetimeUsingBlockhash(lifetimeConstraint, tx),
    tx => appendTransactionMessageInstruction(instruction, tx)
  );

  console.log('✅ Solana 交易消息构建完成');

  const signedTx = await signTransactionMessageWithSigners(transactionMessage);

  const signedTransaction = getBase64EncodedWireTransaction(signedTx);

  const txSignature = signedTx.signatures[solanaSigner.address];
  if (!txSignature) {
    return {
      success: false,
      error: 'Solana 交易签名失败'
    };
  }

  const transactionHash = bs58.encode(new Uint8Array(txSignature));

  console.log('✅ Solana 交易签名完成');
  console.log('📤 签名后的交易 (Base64):', `${signedTransaction.substring(0, 50)}...`);
  console.log('🔖 交易签名 (Base58):', transactionHash);

  return {
    success: true,
    data: {
      signedTransaction,
      transactionHash
    }
  };
}

async function buildInstruction(request: SignTransactionRequest, solanaSigner: any) {
  if (request.tokenAddress) {
    console.log('📦 构建 SPL Token 转账指令');

    const tokenProgramAddress =
      request.tokenType === 'spl-token-2022' ? TOKEN_PROGRAM_2022_ADDRESS : TOKEN_PROGRAM_ADDRESS;

    const [sourceAta] = await findAssociatedTokenPda({
      owner: solanaAddress(request.address),
      mint: solanaAddress(request.tokenAddress),
      tokenProgram: tokenProgramAddress
    });

    const [destAta] = await findAssociatedTokenPda({
      owner: solanaAddress(request.to),
      mint: solanaAddress(request.tokenAddress),
      tokenProgram: tokenProgramAddress
    });

    const baseInstruction = getTransferInstruction({
      source: sourceAta,
      destination: destAta,
      authority: solanaSigner,
      amount: BigInt(request.amount)
    });

    if (request.tokenType === 'spl-token-2022') {
      return {
        ...baseInstruction,
        programAddress: tokenProgramAddress
      } as typeof baseInstruction;
    }

    return baseInstruction;
  }

  console.log('💎 构建 SOL 转账指令');

  return getTransferSolInstruction({
    source: solanaSigner,
    destination: solanaAddress(request.to),
    amount: BigInt(request.amount)
  });
}
