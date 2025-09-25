#!/usr/bin/env ts-node

/**
 * 模拟用户提现测试脚本
 * 使用方法: npx ts-node src/scripts/requestWithdraw.ts
 */

import axios from 'axios';

// 配置参数
const CONFIG = {
  WALLET_SERVICE_URL: 'http://localhost:3000',
  USER_ID: 1,
  TO_ADDRESS: '0x1f35B7b2CaB4b3dFEA7AE56F40D6c7B531940f40', // 测试地址
  AMOUNT: '0.01',
  TOKEN_SYMBOL: 'ETH',
  CHAIN_ID: 31337,
  CHAIN_TYPE: 'evm'
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
    withdrawId: string;
    [key: string]: any;
  };
}

interface HealthResponse {
  status: string;
  message?: string;
}

class WithdrawTester {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * 检查服务健康状态
   */
  async checkHealth(): Promise<boolean> {
    try {
      console.log('检查钱包服务状态...');
      const response = await axios.get<HealthResponse>(`${this.baseUrl}/health`);
      
      if (response.status === 200) {
        console.log('✅ 钱包服务运行正常');
        return true;
      } else {
        console.log('❌ 钱包服务状态异常');
        return false;
      }
    } catch (error) {
      console.log('❌ 钱包服务未运行，请先启动服务: npm run dev');
      return false;
    }
  }

  /**
   * 发送提现请求
   */
  async requestWithdraw(request: WithdrawRequest): Promise<WithdrawResponse> {
    try {
      console.log('发送提现请求...');
      
      const response = await axios.post<WithdrawResponse>(
        `${this.baseUrl}/api/user/withdraw`,
        request,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30秒超时
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // 服务器返回错误响应
          return {
            success: false,
            error: `服务器错误: ${error.response.status} - ${error.response.data?.error || error.message}`
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
  displayResult(response: WithdrawResponse): void {
    console.log('\n提现请求响应:');
    console.log(JSON.stringify(response, null, 2));

    if (response.success && response.data?.withdrawId) {
      const withdrawId = response.data.withdrawId;
      console.log('\n📋 提现记录ID:', withdrawId);
      console.log('🔍 查看提现详情:', `curl -s ${this.baseUrl}/api/withdraws/${withdrawId} | jq '.'`);
      console.log('📊 查看用户提现历史:', `curl -s ${this.baseUrl}/api/user/${CONFIG.USER_ID}/withdraws | jq '.'`);
    }
  }

  /**
   * 运行测试
   */
  async runTest(): Promise<void> {
    console.log('=== 模拟用户提现测试 ===');
    console.log('用户ID:', CONFIG.USER_ID);
    console.log('提现地址:', CONFIG.TO_ADDRESS);
    console.log('提现金额:', CONFIG.AMOUNT, CONFIG.TOKEN_SYMBOL);
    console.log('链ID:', CONFIG.CHAIN_ID);
    console.log('链类型:', CONFIG.CHAIN_TYPE);
    console.log('');

    // 1. 检查服务健康状态
    const isHealthy = await this.checkHealth();
    if (!isHealthy) {
      process.exit(1);
    }

    console.log('');

    // 2. 发送提现请求
    const withdrawRequest: WithdrawRequest = {
      userId: CONFIG.USER_ID,
      to: CONFIG.TO_ADDRESS,
      amount: CONFIG.AMOUNT,
      tokenSymbol: CONFIG.TOKEN_SYMBOL,
      chainId: CONFIG.CHAIN_ID,
      chainType: CONFIG.CHAIN_TYPE
    };

    const response = await this.requestWithdraw(withdrawRequest);

    // 3. 显示结果
    this.displayResult(response);

    console.log('\n=== 测试完成 ===');
  }
}

// 主函数
async function main(): Promise<void> {
  const tester = new WithdrawTester(CONFIG.WALLET_SERVICE_URL);
  await tester.runTest();
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch((error) => {
    console.error('测试失败:', error);
    process.exit(1);
  });
}

export { WithdrawTester, CONFIG };
