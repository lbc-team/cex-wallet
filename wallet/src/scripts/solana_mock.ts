import 'dotenv/config';
import { getDbGatewayClient } from '../services/dbGatewayClient';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Solana 测试数据初始化脚本
 *
 * 功能:
 * 1. 读取部署的 SPL Token 信息
 * 2. 将 Token 信息写入 tokens 表
 * 3. 为测试用户创建 Solana 钱包地址
 * 4. 自动生成 ATA 地址并保存到数据库
 *
 * 运行前提:
 * 1. 已运行 deploySplTokens.ts 部署 Token
 * 2. db_gateway 服务已启动
 * 3. signer 服务已启动
 * 4. wallet 服务已启动
 *
 * 使用方法:
 * ts-node src/scripts/solana_mock.ts
 */

// 简单的日志函数
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || ''),
  success: (message: string, data?: any) => console.log(`[SUCCESS] ✅ ${message}`, data || '')
};

async function initializeSolanaData() {
  try {
    console.log('🚀 开始 Solana 测试数据初始化...\n');

    const dbGateway = getDbGatewayClient();

    // 1. 读取部署的 Token 信息
    logger.info('步骤 1: 读取部署的 Token 信息');
    const tokenInfoPath = path.join(__dirname, 'deployed-tokens.json');

    if (!fs.existsSync(tokenInfoPath)) {
      logger.error('未找到 deployed-tokens.json 文件');
      logger.error('请先运行: ts-node src/scripts/deploySplTokens.ts');
      process.exit(1);
    }

    const deployedTokens = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf-8'));
    logger.success('Token 信息读取成功', {
      payer: deployedTokens.payer,
      tokenCount: deployedTokens.tokens.length
    });

    // 2. 将 Token 信息写入 tokens 表
    logger.info('\n步骤 2: 将 Token 信息写入数据库');

    // Solana 主网使用 chain_id: 101 (Mainnet Beta)
    // Solana 测试网使用 chain_id: 102 (Testnet)
    // Solana 开发网使用 chain_id: 103 (Devnet)
    // 本地测试验证器使用 chain_id: 900 (Localnet)
    const SOLANA_LOCALNET_CHAIN_ID = 900;

    for (const token of deployedTokens.tokens) {
      try {
        // 检查是否已存在
        const existing = await dbGateway.getTokens({
          chain_id: SOLANA_LOCALNET_CHAIN_ID,
          token_symbol: token.symbol
        });

        if (existing.length === 0) {
          await dbGateway.createToken({
            chain_type: 'solana',
            chain_id: SOLANA_LOCALNET_CHAIN_ID,
            token_address: token.mint,  // mint address
            token_symbol: token.symbol,
            token_name: token.name,
            decimals: token.decimals,
            is_native: false,
            collect_amount: '0',
            withdraw_fee: '0',
            min_withdraw_amount: '1000000',  // 1 USDC/USDT
            status: 1
          });
          logger.success(`${token.symbol} Token 配置创建成功`, {
            mint: token.mint,
            decimals: token.decimals
          });
        } else {
          logger.info(`${token.symbol} Token 配置已存在`);
        }
      } catch (error) {
        logger.warn(`创建 ${token.symbol} Token 配置失败:`, error);
      }
    }

    // 添加 SOL 原生代币配置
    try {
      const existingSOL = await dbGateway.getTokens({
        chain_id: SOLANA_LOCALNET_CHAIN_ID,
        token_symbol: 'SOL'
      });

      if (existingSOL.length === 0) {
        await dbGateway.createToken({
          chain_type: 'solana',
          chain_id: SOLANA_LOCALNET_CHAIN_ID,
          token_address: '',  // SOL 没有 token_address
          token_symbol: 'SOL',
          token_name: 'Solana',
          decimals: 9,
          is_native: true,
          collect_amount: '0',
          withdraw_fee: '5000000',  // 0.005 SOL
          min_withdraw_amount: '10000000',  // 0.01 SOL
          status: 1
        });
        logger.success('SOL 原生代币配置创建成功');
      } else {
        logger.info('SOL 原生代币配置已存在');
      }
    } catch (error) {
      logger.warn('创建 SOL 代币配置失败:', error);
    }

    // 3. 为测试用户创建 Solana 钱包地址（通过 API）
    logger.info('\n步骤 3: 为测试用户创建 Solana 钱包地址');
    logger.info('通过 API 调用 wallet 服务...');

    const userCount = 5;  // 创建 5 个测试用户的 Solana 钱包
    const createdWallets = [];

    for (let i = 1; i <= userCount; i++) {
      try {
        logger.info(`正在为用户 ${i} 创建 Solana 钱包...`);

        const response = await fetch(
          `http://localhost:3000/api/user/${i}/address?chain_type=solana`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        const data = await response.json();

        if (response.ok && (data as any).message && (data as any).data) {
          const walletData = (data as any).data;
          createdWallets.push({
            userId: i,
            address: walletData.address,
            walletId: walletData.id
          });
          logger.success(`用户 ${i} Solana 钱包创建成功`, {
            address: walletData.address,
            walletId: walletData.id
          });
        } else {
          logger.warn(`用户 ${i} Solana 钱包创建失败:`, data);
        }

        // 等待一下，避免请求过快
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        logger.error(`用户 ${i} Solana 钱包创建请求失败:`, error);
      }
    }

    // 4. 验证 ATA 生成
    logger.info('\n步骤 4: 验证 ATA 地址生成');
    logger.info('查询数据库中的 ATA 记录...');

    try {
      const ataRecords = await dbGateway.queryData('solana_token_accounts', {});

      if (ataRecords.length > 0) {
        logger.success(`找到 ${ataRecords.length} 条 ATA 记录`);

        // 按用户分组显示
        const userATAs: Record<number, any[]> = {};
        for (const record of ataRecords) {
          const userId = record.user_id;
          if (userId) {
            if (!userATAs[userId]) {
              userATAs[userId] = [];
            }
            userATAs[userId]!.push(record);
          }
        }

        console.log('\n📋 ATA 记录详情:');
        console.log('═'.repeat(80));

        for (const [userId, atas] of Object.entries(userATAs)) {
          const wallet = createdWallets.find(w => w.userId === parseInt(userId));
          console.log(`\n用户 ID: ${userId}`);
          if (wallet) {
            console.log(`钱包地址: ${wallet.address}`);
          }
          console.log(`ATA 数量: ${atas.length}`);
          console.log('-'.repeat(80));

          atas.forEach((ata, index) => {
            const token = deployedTokens.tokens.find((t: any) => t.mint === ata.token_mint);
            console.log(`  ${index + 1}. ${token ? token.symbol : 'Unknown'}`);
            console.log(`     Mint: ${ata.token_mint}`);
            console.log(`     ATA:  ${ata.ata_address}`);
          });
        }
        console.log('═'.repeat(80));

      } else {
        logger.warn('未找到任何 ATA 记录');
        logger.warn('可能的原因:');
        logger.warn('1. getUserWallet 函数中的 ATA 生成逻辑未执行');
        logger.warn('2. 数据库写入失败');
        logger.warn('3. Token 表中没有 Solana 代币');
      }

    } catch (error) {
      logger.error('查询 ATA 记录失败:', error);
    }

    // 5. 显示最终统计
    logger.info('\n步骤 5: 最终统计');
    console.log('═'.repeat(80));

    const solanaTokens = await dbGateway.getTokens({ chain_id: SOLANA_LOCALNET_CHAIN_ID });
    logger.info(`Solana 代币总数: ${solanaTokens.length}`);
    solanaTokens.forEach(token => {
      console.log(`  - ${token.token_symbol}: ${token.token_address || '(原生代币)'}`);
    });

    const solanaWallets = await dbGateway.getWallets({ chain_type: 'solana' });
    logger.info(`\nSolana 钱包总数: ${solanaWallets.length}`);

    const ataRecords = await dbGateway.queryData('solana_token_accounts', {});
    logger.info(`ATA 记录总数: ${ataRecords.length}`);

    console.log('═'.repeat(80));

    logger.success('\n\n🎉 Solana 测试数据初始化完成！');

    if (ataRecords.length === 0) {
      console.log('\n⚠️  提示: 如果没有看到 ATA 记录，请检查:');
      console.log('1. wallet/src/services/walletBusinessService.ts 中的 getUserWallet 函数');
      console.log('2. 确认 findAllTokensByChain 方法返回了 Solana 代币');
      console.log('3. 检查 wallet 服务的日志输出');
    }

    process.exit(0);

  } catch (error) {
    logger.error('Solana 测试数据初始化失败', { error });
    process.exit(1);
  }
}

if (require.main === module) {
  initializeSolanaData();
}

export { initializeSolanaData };
