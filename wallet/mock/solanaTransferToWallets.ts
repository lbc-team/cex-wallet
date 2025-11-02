import 'dotenv/config';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import sqlite3 from 'sqlite3';

const RPC_URL = process.env.SOLANA_RPC_URL || 'http://localhost:8899';
const ONE_SOL = LAMPORTS_PER_SOL;

function resolveDbPath(): string {
  if (process.env.WALLET_DB_PATH) {
    return process.env.WALLET_DB_PATH;
  }
  return path.resolve(__dirname, '../../../db_gateway/wallet.db');
}

function resolveKeypairPath(): string {
  if (process.env.SOLANA_KEYPAIR_PATH) {
    return path.resolve(process.env.SOLANA_KEYPAIR_PATH);
  }
  if (process.env.SOLANA_PAYER_KEYPAIR) {
    return path.resolve(process.env.SOLANA_PAYER_KEYPAIR);
  }
  return path.join(process.env.HOME || '', '.config', 'solana', 'id.json');
}

function keypairFromString(raw: string): Keypair {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[')) {
    throw new Error('密钥字符串必须是 JSON 数组格式');
  }
  const secret = JSON.parse(trimmed) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function loadPayerKeypair(): Keypair {
  if (process.env.SOLANA_PAYER_SECRET) {
    return keypairFromString(process.env.SOLANA_PAYER_SECRET);
  }

  const keypairPath = resolveKeypairPath();
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`未找到 Solana 密钥文件，请检查: ${keypairPath}`);
  }
  const raw = fs.readFileSync(keypairPath, 'utf-8');
  return keypairFromString(raw);
}

async function querySolanaWallets(): Promise<string[]> {
  const dbPath = resolveDbPath();
  const database = new sqlite3.Database(dbPath);

  return new Promise((resolve, reject) => {
    database.all(
      `SELECT address
       FROM wallets
       WHERE chain_type = 'solana' AND is_active = 1`,
      (err, rows: Array<{ address: string }>) => {
        database.close();
        if (err) {
          reject(err);
          return;
        }
        const addresses = rows
          .map((row) => row.address)
          .filter((addr): addr is string => Boolean(addr));
        resolve(addresses);
      }
    );
  });
}

async function ensurePayerBalance(connection: Connection, payer: Keypair, requiredLamports: number) {
  const current = await connection.getBalance(payer.publicKey, 'confirmed');
  if (current >= requiredLamports) {
    return;
  }

  const lamportsNeeded = requiredLamports - current;
  const requestLamports = Math.ceil(lamportsNeeded / LAMPORTS_PER_SOL + 1) * LAMPORTS_PER_SOL;
  console.log(`🔄 请求空投 ${(requestLamports / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  const sig = await connection.requestAirdrop(payer.publicKey, requestLamports);
  await connection.confirmTransaction(sig, 'confirmed');
}

async function sendTransactionWithTimeout(
  connection: Connection,
  transaction: Transaction,
  signers: Keypair[],
  timeoutMs: number = 30000
): Promise<string> {
  const promise = sendAndConfirmTransaction(connection, transaction, signers, {
    commitment: 'processed',
    skipPreflight: false,
    preflightCommitment: 'processed',
    maxRetries: 3
  });

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`交易超时 (${timeoutMs}ms)`)), timeoutMs);
  });

  return Promise.race([promise, timeout]);
}

async function transferOneSolToAll(): Promise<void> {
  const connection = new Connection(RPC_URL, 'processed');
  const payer = loadPayerKeypair();

  console.log('🚀 开始批量转账');
  console.log('RPC Endpoint:', RPC_URL);
  console.log('Payer:', payer.publicKey.toBase58());

  const wallets = await querySolanaWallets();
  if (wallets.length === 0) {
    console.log('⚠️ 未找到任何 Solana 地址，退出');
    return;
  }

  console.log(`🎯 将向 ${wallets.length} 个地址各转 1 SOL`);
  await ensurePayerBalance(connection, payer, wallets.length * ONE_SOL);

  for (const [index, address] of wallets.entries()) {
    try {
      const toPubkey = new PublicKey(address);
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey,
          lamports: ONE_SOL
        })
      );

      console.log(`🔁 [${index + 1}/${wallets.length}] 转账到 ${address}`);
      const signature = await sendTransactionWithTimeout(connection, transaction, [payer], 30000);
      console.log(`✅ 成功，签名: ${signature}`);
    } catch (error) {
      console.error(`❌ 转账到 ${address} 失败`, error);
    }
  }

  console.log('\n🎉 所有转账任务完成');
}

interface TokenInfo {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  payerTokenAccount: string;
}

interface DeployedTokens {
  payer: string;
  tokens: TokenInfo[];
}

function loadDeployedTokens(): DeployedTokens {
  const tokensPath = path.resolve(__dirname, 'deployed-tokens.json');
  if (!fs.existsSync(tokensPath)) {
    throw new Error(`未找到 deployed-tokens.json 文件: ${tokensPath}`);
  }
  const raw = fs.readFileSync(tokensPath, 'utf-8');
  return JSON.parse(raw) as DeployedTokens;
}

async function transferTokensToAll(): Promise<void> {
  const connection = new Connection(RPC_URL, 'processed');
  const payer = loadPayerKeypair();
  const deployedTokens = loadDeployedTokens();

  console.log('🚀 开始批量Token转账');
  console.log('RPC Endpoint:', RPC_URL);
  console.log('Payer:', payer.publicKey.toBase58());

  const wallets = await querySolanaWallets();
  if (wallets.length === 0) {
    console.log('⚠️ 未找到任何 Solana 地址，退出');
    return;
  }

  console.log(`🎯 将向 ${wallets.length} 个地址转账 ${deployedTokens.tokens.length} 种Token`);

  // 为每个token转账
  for (const tokenInfo of deployedTokens.tokens) {
    console.log(`\n💰 开始转账 ${tokenInfo.symbol}...`);
    console.log(`   Token Mint: ${tokenInfo.mint}`);
    console.log(`   Decimals: ${tokenInfo.decimals}`);

    const mintPubkey = new PublicKey(tokenInfo.mint);
    const payerTokenAccount = new PublicKey(tokenInfo.payerTokenAccount);

    // 每个token转账25个（考虑decimals）
    const transferAmount = 25 * Math.pow(10, tokenInfo.decimals);

    for (const [index, address] of wallets.entries()) {
      try {
        const toPubkey = new PublicKey(address);

        // 获取目标地址的ATA
        const toTokenAccount = await getAssociatedTokenAddress(
          mintPubkey,
          toPubkey,
          false,
          TOKEN_PROGRAM_ID
        );

        // 检查ATA是否存在
        const accountInfo = await connection.getAccountInfo(toTokenAccount);
        const transaction = new Transaction();

        // 如果ATA不存在，添加创建ATA的指令
        if (!accountInfo) {
          console.log(`   📝 [${index + 1}/${wallets.length}] 为 ${address} 创建 ${tokenInfo.symbol} ATA`);
          transaction.add(
            createAssociatedTokenAccountInstruction(
              payer.publicKey,  // payer
              toTokenAccount,   // ATA address
              toPubkey,        // owner
              mintPubkey,      // mint
              TOKEN_PROGRAM_ID
            )
          );
        }

        // 添加转账指令
        transaction.add(
          createTransferInstruction(
            payerTokenAccount,  // source
            toTokenAccount,     // destination
            payer.publicKey,    // owner
            transferAmount,     // amount
            [],                 // multi signers
            TOKEN_PROGRAM_ID
          )
        );

        console.log(`   🔁 [${index + 1}/${wallets.length}] 转账 ${transferAmount / Math.pow(10, tokenInfo.decimals)} ${tokenInfo.symbol} 到 ${address}`);
        const signature = await sendTransactionWithTimeout(connection, transaction, [payer], 30000);
        console.log(`   ✅ 成功，签名: ${signature}`);
      } catch (error) {
        console.error(`   ❌ 转账 ${tokenInfo.symbol} 到 ${address} 失败`, error);
      }
    }

    console.log(`✨ ${tokenInfo.symbol} 转账完成`);
  }

  console.log('\n🎉 所有Token转账任务完成');
}

async function transferAll(): Promise<void> {
  console.log('=' .repeat(60));
  console.log('开始批量转账（SOL + Tokens）');
  console.log('=' .repeat(60));

  // 先转SOL
  await transferOneSolToAll();

  // 再转Tokens
  await transferTokensToAll();

  console.log('\n' + '=' .repeat(60));
  console.log('所有转账完成！');
  console.log('=' .repeat(60));
}

if (require.main === module) {
  transferAll()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('脚本执行失败:', error);
      process.exit(1);
    });
}

export { transferOneSolToAll, transferTokensToAll, transferAll };
