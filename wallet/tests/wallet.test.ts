import { 
  HttpClient, 
  TestResult, 
  generateCreateWalletRequest, 
  colorLog, 
  delay,
  CreateWalletRequest 
} from './test-utils';

// 钱包测试类
export class WalletTest {
  private client: HttpClient;
  private result: TestResult;

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.client = new HttpClient(baseUrl);
    this.result = new TestResult();
  }

  // 运行所有测试
  async runAllTests(): Promise<void> {
    colorLog('\n🚀 开始钱包API测试...', 'cyan');
    
    try {
      await this.testServerHealth();
      await this.testGetUserWallet();
      
      this.result.printSummary();
    } catch (error) {
      colorLog(`❌ 测试执行失败: ${error}`, 'red');
    }
  }

  // 测试服务器健康状态
  private async testServerHealth(): Promise<void> {
    const startTime = Date.now();
    try {
      const response = await this.client.get('/');
      const duration = Date.now() - startTime;
      
      if (response.message && response.data) {
        this.result.addResult(
          '服务器健康检查',
          'PASS',
          `服务器正常运行 - ${response.message}`,
          duration
        );
        colorLog('✅ 服务器健康检查通过', 'green');
      } else {
        throw new Error('响应格式不正确');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '服务器健康检查',
        'FAIL',
        `服务器连接失败: ${error}`,
        duration
      );
      colorLog('❌ 服务器健康检查失败', 'red');
    }
  }

  // 测试获取用户钱包（通过 signer 模块）
  private async testGetUserWallet(): Promise<void> {
    const startTime = Date.now();
    try {
      const userId = 1; // 测试用户ID
      const response = await this.client.get(`/api/user/${userId}/address?chain_type=evm`);
      const duration = Date.now() - startTime;
      
      if (response.message === '获取用户钱包成功' && response.data) {
        this.result.addResult(
          '获取用户钱包',
          'PASS',
          `获取用户钱包成功 - ID: ${response.data.id}`,
          duration
        );
        colorLog(`✅ 获取用户钱包成功 - 地址: ${response.data.address}`, 'green');
        
        // 保存钱包ID供后续测试使用
        (this as any).createdWalletId = response.data.id;
        (this as any).createdWallet = response.data;
        (this as any).testUserId = userId;
      } else {
        throw new Error('获取用户钱包失败');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '获取用户钱包',
        'FAIL',
        `获取用户钱包失败: ${error}`,
        duration
      );
      colorLog('❌ 获取用户钱包失败', 'red');
    }
  }

}

// 运行测试的主函数
async function runWalletTests(): Promise<void> {
  const test = new WalletTest();
  await test.runAllTests();
}

// 导出测试运行函数供外部调用
export { runWalletTests };
