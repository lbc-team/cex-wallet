#!/usr/bin/env ts-node

/**
 * 模拟 Solana 用户提现测试脚本
 * 使用方法: npx ts-node mock/requestWithdrawOnSolana.ts
 */

import axios from 'axios';

// 配置参数
const CONFIG = {
  WALLET_SERVICE_URL: 'http://localhost:3000',
  USER_ID: 3,  // 使用普通用户（用户 2 是热钱包）
  // Solana 测试地址 (需要替换为实际的 Solana 地址)
  TO_ADDRESS: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
  AMOUNT_SOL: '0.01',  // 0.01 SOL
  AMOUNT_USDC: '10',    // 10 USDC
  AMOUNT_USDT: '10',    // 10 USDT
  CHAIN_ID: 900,        // Solana 本地测试网
  CHAIN_TYPE: 'solana'
} as const;

interface WithdrawRequest {
  userId: number;
  to: string;
  amount: string;
  tokenSymbol: string;
  chainId: number;
  chainType: string;
}

interface WithdrawResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    withdrawId: number;
    transactionHash: string;
    signedTransaction: string;
    withdrawAmount: string;
    actualAmount: string;
    fee: string;
    gasEstimation?: any;
    [key: string]: any;
  };
}

class SolanaWithdrawTester {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * 检查服务健康状态
   */
  async checkHealth(): Promise<boolean> {
    try {
      console.log('检查 Wallet 服务健康状态...');
      const response = await axios.get(`${this.baseUrl}/health`, {
        timeout: 5000
      });

      if (response.status === 200) {
        console.log('✅ Wallet 服务运行正常');
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Wallet 服务不可用:', error instanceof Error ? error.message : '未知错误');
      console.error('请确保 wallet 服务正在运行 (端口: 3000)');
      return false;
    }
  }

  /**
   * 获取用户余额
   */
  async getUserBalance(userId: number): Promise<void> {
    try {
      console.log('\n查询用户余额...');
      const response = await axios.get(`${this.baseUrl}/api/user/${userId}/balance/total`);

      if (response.data.success) {
        console.log('✅ 用户余额:');
        const balances = response.data.data || [];
        const solanaBalances = balances.filter((b: any) =>
          ['SOL', 'USDC', 'USDT'].includes(b.token_symbol)
        );

        if (solanaBalances.length > 0) {
          solanaBalances.forEach((balance: any) => {
            console.log(`  ${balance.token_symbol}: ${balance.available_balance} (可用)`);
          });
        } else {
          console.log('  没有 Solana 相关代币余额');
        }
      }
    } catch (error) {
      console.error('❌ 查询余额失败:', error instanceof Error ? error.message : '未知错误');
    }
  }

  /**
   * 发送提现请求
   */
  async requestWithdraw(request: WithdrawRequest): Promise<WithdrawResponse> {
    try {
      console.log('发送 Solana 提现请求...');
      console.log('  目标地址:', request.to);
      console.log('  代币:', request.tokenSymbol);
      console.log('  金额:', request.amount);

      const response = await axios.post<WithdrawResponse>(
        `${this.baseUrl}/api/user/withdraw`,
        request,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 60秒超时 (Solana 交易可能需要更长时间)
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // 服务器返回错误响应
          return {
            success: false,
            error: `服务器错误: ${error.response.status} - ${JSON.stringify(error.response.data)}`
          };
        } else if (error.request) {
          // 网络错误
          return {
            success: false,
            error: `网络错误: 无法连接到钱包服务`
          };
        }
      }

      return {
        success: false,
        error: `请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 显示提现结果
   */
  displayResult(response: WithdrawResponse, tokenSymbol: string): void {
    console.log(`${tokenSymbol} 提现结果:`);

    if (response.success && response.data) {
      console.log('✅ 提现请求成功!');
      console.log('\n交易信息:');
      console.log('  提现记录ID:', response.data.withdrawId);
      console.log('  交易签名 (Base58):', response.data.transactionHash);
      console.log('  提现金额:', response.data.withdrawAmount);
      console.log('  实际到账:', response.data.actualAmount);
      console.log('  手续费:', response.data.fee);

      console.log('\n查看命令:');
      console.log(`  查看提现详情: curl -s ${this.baseUrl}/api/withdraws/${response.data.withdrawId} | jq '.'`);
      console.log(`  查看用户提现历史: curl -s ${this.baseUrl}/api/user/${CONFIG.USER_ID}/withdraws | jq '.'`);

      if (response.data.transactionHash) {
        console.log('\n💡 提示: 在 Solana Explorer 查看交易:');
        console.log(`  solana confirm -v ${response.data.transactionHash}`);
      }
    } else {
      console.log('❌ 提现请求失败!');
      console.log('  错误信息:', response.error || response.message || '未知错误');
    }
    console.log('='.repeat(80) + '\n');
  }

  /**
   * 测试 SOL 原生代币提现
   */
  async testSOLWithdraw(): Promise<void> {
    console.log('\n--- 测试 SOL 原生代币提现 ---');
    console.log('提现金额:', CONFIG.AMOUNT_SOL, 'SOL');

    const withdrawRequest: WithdrawRequest = {
      userId: CONFIG.USER_ID,
      to: CONFIG.TO_ADDRESS,
      amount: CONFIG.AMOUNT_SOL,
      tokenSymbol: 'SOL',
      chainId: CONFIG.CHAIN_ID,
      chainType: CONFIG.CHAIN_TYPE
    };

    const response = await this.requestWithdraw(withdrawRequest);
    this.displayResult(response, 'SOL');
  }

  /**
   * 测试 USDC (SPL Token) 提现
   */
  async testUSDCWithdraw(): Promise<void> {
    console.log('\n--- 测试 USDC (SPL Token) 提现 ---');
    console.log('提现金额:', CONFIG.AMOUNT_USDC, 'USDC');

    const withdrawRequest: WithdrawRequest = {
      userId: CONFIG.USER_ID,
      to: CONFIG.TO_ADDRESS,
      amount: CONFIG.AMOUNT_USDC,
      tokenSymbol: 'USDC',
      chainId: CONFIG.CHAIN_ID,
      chainType: CONFIG.CHAIN_TYPE
    };

    const response = await this.requestWithdraw(withdrawRequest);
    this.displayResult(response, 'USDC');
  }

  /**
   * 测试 USDT (SPL Token) 提现
   */
  async testUSDTWithdraw(): Promise<void> {
    console.log('\n--- 测试 USDT (SPL Token) 提现 ---');
    console.log('提现金额:', CONFIG.AMOUNT_USDT, 'USDT');

    const withdrawRequest: WithdrawRequest = {
      userId: CONFIG.USER_ID,
      to: CONFIG.TO_ADDRESS,
      amount: CONFIG.AMOUNT_USDT,
      tokenSymbol: 'USDT',
      chainId: CONFIG.CHAIN_ID,
      chainType: CONFIG.CHAIN_TYPE
    };

    const response = await this.requestWithdraw(withdrawRequest);
    this.displayResult(response, 'USDT');
  }

  /**
   * 运行所有测试
   */
  async runAllTests(): Promise<void> {
    console.log('=== Solana 链提现测试 ===');
    console.log('配置信息:');
    console.log('  用户ID:', CONFIG.USER_ID);
    console.log('  提现地址:', CONFIG.TO_ADDRESS);
    console.log('  链ID:', CONFIG.CHAIN_ID);
    console.log('  链类型:', CONFIG.CHAIN_TYPE);
    console.log('='.repeat(80));

    // 1. 健康检查
    const isHealthy = await this.checkHealth();
    if (!isHealthy) {
      console.error('\n❌ Wallet 服务不可用，测试终止');
      process.exit(1);
    }

    // 2. 查询用户余额
    await this.getUserBalance(CONFIG.USER_ID);

    // 3. 测试 SOL 提现
    await this.testSOLWithdraw();

    // 等待一下，避免并发问题
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 4. 测试 USDC 提现
    await this.testUSDCWithdraw();

    // 等待一下
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 5. 测试 USDT 提现
    await this.testUSDTWithdraw();

    console.log('=== 所有测试完成 ===');
  }

  /**
   * 运行单个代币测试
   */
  async runSingleTest(tokenSymbol: 'SOL' | 'USDC' | 'USDT'): Promise<void> {
    console.log(`=== Solana ${tokenSymbol} 提现测试 ===`);
    console.log('='.repeat(80));

    // 1. 健康检查
    const isHealthy = await this.checkHealth();
    if (!isHealthy) {
      console.error('\n❌ Wallet 服务不可用，测试终止');
      process.exit(1);
    }

    // 2. 查询用户余额
    await this.getUserBalance(CONFIG.USER_ID);

    // 3. 执行对应的提现测试
    switch (tokenSymbol) {
      case 'SOL':
        await this.testSOLWithdraw();
        break;
      case 'USDC':
        await this.testUSDCWithdraw();
        break;
      case 'USDT':
        await this.testUSDTWithdraw();
        break;
    }

    console.log('=== 测试完成 ===');
  }
}

// 主函数
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tester = new SolanaWithdrawTester(CONFIG.WALLET_SERVICE_URL);

  // 如果指定了代币符号，只测试该代币
  if (args.length > 0) {
    const tokenSymbol = args[0]!.toUpperCase();
    if (['SOL', 'USDC', 'USDT'].includes(tokenSymbol)) {
      await tester.runSingleTest(tokenSymbol as 'SOL' | 'USDC' | 'USDT');
    } else {
      console.error('❌ 不支持的代币符号:', tokenSymbol);
      console.error('支持的代币: SOL, USDC, USDT');
      console.error('\n使用方法:');
      console.error('  npx ts-node mock/requestWithdrawOnSolana.ts [TOKEN_SYMBOL]');
      console.error('  例如: npx ts-node mock/requestWithdrawOnSolana.ts SOL');
      process.exit(1);
    }
  } else {
    // 运行所有测试
    await tester.runAllTests();
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch((error) => {
    console.error('测试失败:', error);
    process.exit(1);
  });
}

export { SolanaWithdrawTester, CONFIG };
