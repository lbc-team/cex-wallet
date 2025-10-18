/**
 * 部署两个 SPL Token 到本地 Solana 测试验证器
 *
 * 运行前确保:
 * 1. solana-test-validator 已启动
 * 2. 已安装 @solana/web3.js 和 @solana/spl-token
 *
 * 使用方法:
 * ts-node src/scripts/deploySplTokens.ts
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createMint, mintTo, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// 连接到本地测试验证器
const connection = new Connection('http://localhost:8899', 'confirmed');

// 从环境变量或本地密钥文件加载钱包
function loadWallet(): Keypair {
  // 尝试从 solana 配置目录加载
  const keypairPath = path.join(process.env.HOME || '', '.config/solana/id.json');

  if (fs.existsSync(keypairPath)) {
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    return Keypair.fromSecretKey(new Uint8Array(keypairData));
  }

  // 如果没有找到，生成新的密钥对
  console.log('⚠️  未找到 Solana 密钥文件，生成新的密钥对');
  return Keypair.generate();
}

async function deployTokens() {
  try {
    console.log('🚀 开始部署 SPL Tokens...\n');

    // 加载钱包
    const payer = loadWallet();
    console.log('💰 Payer 地址:', payer.publicKey.toBase58());

    // 检查余额
    const balance = await connection.getBalance(payer.publicKey);
    console.log('💵 Payer 余额:', balance / 1e9, 'SOL\n');

    if (balance === 0) {
      console.log('⚠️  余额不足，正在空投 SOL...');
      const airdropSignature = await connection.requestAirdrop(
        payer.publicKey,
        2 * 1e9 // 2 SOL
      );
      await connection.confirmTransaction(airdropSignature);
      console.log('✅ 空投成功\n');
    }

    // 部署第一个 Token (USDC)
    console.log('📦 部署 Token 1: Mock USDC');
    const usdcMint = await createMint(
      connection,
      payer,
      payer.publicKey,      // mint authority
      payer.publicKey,      // freeze authority
      6                     // decimals (USDC 使用 6 位小数)
    );
    console.log('✅ USDC Mint 地址:', usdcMint.toBase58());

    // 部署第二个 Token (USDT)
    console.log('\n📦 部署 Token 2: Mock USDT');
    const usdtMint = await createMint(
      connection,
      payer,
      payer.publicKey,      // mint authority
      payer.publicKey,      // freeze authority
      6                     // decimals (USDT 使用 6 位小数)
    );
    console.log('✅ USDT Mint 地址:', usdtMint.toBase58());

    // 创建 token account 并铸造一些代币给 payer（用于测试）
    console.log('\n🏦 为 Payer 创建 Token Accounts 并铸造代币...');

    const usdcTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      usdcMint,
      payer.publicKey
    );
    console.log('USDC Token Account:', usdcTokenAccount.address.toBase58());

    await mintTo(
      connection,
      payer,
      usdcMint,
      usdcTokenAccount.address,
      payer.publicKey,
      1000000 * 1e6 // 1,000,000 USDC
    );
    console.log('✅ 铸造 1,000,000 USDC');

    const usdtTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      usdtMint,
      payer.publicKey
    );
    console.log('USDT Token Account:', usdtTokenAccount.address.toBase58());

    await mintTo(
      connection,
      payer,
      usdtMint,
      usdtTokenAccount.address,
      payer.publicKey,
      1000000 * 1e6 // 1,000,000 USDT
    );
    console.log('✅ 铸造 1,000,000 USDT');

    // 保存 mint 地址到文件
    const tokenInfo = {
      payer: payer.publicKey.toBase58(),
      tokens: [
        {
          symbol: 'USDC',
          name: 'USD Coin (Test)',
          mint: usdcMint.toBase58(),
          decimals: 6,
          payerTokenAccount: usdcTokenAccount.address.toBase58()
        },
        {
          symbol: 'USDT',
          name: 'Tether USD (Test)',
          mint: usdtMint.toBase58(),
          decimals: 6,
          payerTokenAccount: usdtTokenAccount.address.toBase58()
        }
      ]
    };

    const outputPath = path.join(__dirname, 'deployed-tokens.json');
    fs.writeFileSync(outputPath, JSON.stringify(tokenInfo, null, 2));
    console.log(`\n📝 Token 信息已保存到: ${outputPath}`);

    console.log('\n✅ 所有 Token 部署完成！');
    console.log('\n📋 Token 摘要:');
    console.log('─'.repeat(60));
    tokenInfo.tokens.forEach(token => {
      console.log(`${token.symbol}:`);
      console.log(`  Mint: ${token.mint}`);
      console.log(`  Decimals: ${token.decimals}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ 部署失败:', error);
    throw error;
  }
}

// 执行部署
deployTokens()
  .then(() => {
    console.log('🎉 部署脚本执行完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 部署脚本执行失败:', error);
    process.exit(1);
  });
