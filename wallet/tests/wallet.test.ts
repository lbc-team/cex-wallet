import { 
  HttpClient, 
  TestResult, 
  generateTestWallet, 
  colorLog, 
  delay,
  TestWallet 
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
      await this.testCreateWallet();
      await this.testGetWallets();
      await this.testGetWalletById();
      await this.testGetWalletBalance();
      await this.testUpdateWalletBalance();
      await this.testGetWalletStats();
      await this.testCreateDuplicateWallet();
      await this.testInvalidWalletData();
      
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

  // 测试创建钱包
  private async testCreateWallet(): Promise<void> {
    const startTime = Date.now();
    try {
      const testWallet = generateTestWallet('evm');
      const response = await this.client.post('/api/wallets', testWallet);
      const duration = Date.now() - startTime;
      
      if (response.message === '钱包创建成功' && response.data) {
        this.result.addResult(
          '创建钱包',
          'PASS',
          `钱包创建成功 - ID: ${response.data.id}`,
          duration
        );
        colorLog(`✅ 钱包创建成功 - 地址: ${testWallet.address}`, 'green');
        
        // 保存钱包ID供后续测试使用
        (this as any).createdWalletId = response.data.id;
        (this as any).createdWallet = testWallet;
      } else {
        throw new Error('钱包创建失败');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '创建钱包',
        'FAIL',
        `钱包创建失败: ${error}`,
        duration
      );
      colorLog('❌ 钱包创建失败', 'red');
    }
  }

  // 测试获取所有钱包
  private async testGetWallets(): Promise<void> {
    const startTime = Date.now();
    try {
      const response = await this.client.get('/api/wallets');
      const duration = Date.now() - startTime;
      
      if (response.data && Array.isArray(response.data)) {
        this.result.addResult(
          '获取钱包列表',
          'PASS',
          `获取到 ${response.data.length} 个钱包`,
          duration
        );
        colorLog(`✅ 获取钱包列表成功 - 共 ${response.data.length} 个钱包`, 'green');
      } else {
        throw new Error('钱包列表格式不正确');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '获取钱包列表',
        'FAIL',
        `获取钱包列表失败: ${error}`,
        duration
      );
      colorLog('❌ 获取钱包列表失败', 'red');
    }
  }

  // 测试根据ID获取钱包
  private async testGetWalletById(): Promise<void> {
    const startTime = Date.now();
    try {
      const walletId = (this as any).createdWalletId;
      if (!walletId) {
        throw new Error('没有可用的钱包ID');
      }

      const response = await this.client.get(`/api/wallets/${walletId}`);
      const duration = Date.now() - startTime;
      
      if (response.data && response.data.id === walletId) {
        this.result.addResult(
          '根据ID获取钱包',
          'PASS',
          `成功获取钱包 - ID: ${walletId}`,
          duration
        );
        colorLog(`✅ 根据ID获取钱包成功 - ID: ${walletId}`, 'green');
      } else {
        throw new Error('钱包数据不匹配');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '根据ID获取钱包',
        'FAIL',
        `根据ID获取钱包失败: ${error}`,
        duration
      );
      colorLog('❌ 根据ID获取钱包失败', 'red');
    }
  }

  // 测试获取钱包余额
  private async testGetWalletBalance(): Promise<void> {
    const startTime = Date.now();
    try {
      const walletId = (this as any).createdWalletId;
      if (!walletId) {
        throw new Error('没有可用的钱包ID');
      }

      const response = await this.client.get(`/api/wallets/${walletId}/balance`);
      const duration = Date.now() - startTime;
      
      if (response.data && typeof response.data.balance === 'number') {
        this.result.addResult(
          '获取钱包余额',
          'PASS',
          `钱包余额: ${response.data.balance}`,
          duration
        );
        colorLog(`✅ 获取钱包余额成功 - 余额: ${response.data.balance}`, 'green');
      } else {
        throw new Error('余额数据格式不正确');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '获取钱包余额',
        'FAIL',
        `获取钱包余额失败: ${error}`,
        duration
      );
      colorLog('❌ 获取钱包余额失败', 'red');
    }
  }

  // 测试更新钱包余额
  private async testUpdateWalletBalance(): Promise<void> {
    const startTime = Date.now();
    try {
      const walletId = (this as any).createdWalletId;
      if (!walletId) {
        throw new Error('没有可用的钱包ID');
      }

      const newBalance = 100.5;
      const response = await this.client.put(`/api/wallets/${walletId}/balance`, {
        balance: newBalance
      });
      const duration = Date.now() - startTime;
      
      if (response.message === '余额更新成功') {
        this.result.addResult(
          '更新钱包余额',
          'PASS',
          `余额更新为: ${newBalance}`,
          duration
        );
        colorLog(`✅ 更新钱包余额成功 - 新余额: ${newBalance}`, 'green');
      } else {
        throw new Error('余额更新失败');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '更新钱包余额',
        'FAIL',
        `更新钱包余额失败: ${error}`,
        duration
      );
      colorLog('❌ 更新钱包余额失败', 'red');
    }
  }

  // 测试获取钱包统计
  private async testGetWalletStats(): Promise<void> {
    const startTime = Date.now();
    try {
      const walletId = (this as any).createdWalletId;
      if (!walletId) {
        throw new Error('没有可用的钱包ID');
      }

      const response = await this.client.get(`/api/wallets/${walletId}/stats`);
      const duration = Date.now() - startTime;
      
      if (response.data && response.data.wallet) {
        this.result.addResult(
          '获取钱包统计',
          'PASS',
          `统计信息获取成功`,
          duration
        );
        colorLog('✅ 获取钱包统计成功', 'green');
      } else {
        throw new Error('统计信息格式不正确');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '获取钱包统计',
        'FAIL',
        `获取钱包统计失败: ${error}`,
        duration
      );
      colorLog('❌ 获取钱包统计失败', 'red');
    }
  }

  // 测试创建重复钱包
  private async testCreateDuplicateWallet(): Promise<void> {
    const startTime = Date.now();
    try {
      const testWallet = (this as any).createdWallet;
      if (!testWallet) {
        throw new Error('没有可用的测试钱包数据');
      }

      const response = await this.client.post('/api/wallets', testWallet);
      const duration = Date.now() - startTime;
      
      if (response.error && response.error.includes('已存在')) {
        this.result.addResult(
          '创建重复钱包',
          'PASS',
          `正确拒绝重复钱包创建`,
          duration
        );
        colorLog('✅ 重复钱包创建被正确拒绝', 'green');
      } else {
        throw new Error('应该拒绝重复钱包创建');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '创建重复钱包',
        'FAIL',
        `重复钱包测试失败: ${error}`,
        duration
      );
      colorLog('❌ 重复钱包测试失败', 'red');
    }
  }

  // 测试无效钱包数据
  private async testInvalidWalletData(): Promise<void> {
    const startTime = Date.now();
    try {
      const invalidWallet = {
        address: '', // 空地址
        chain_type: 'evm'
      };

      const response = await this.client.post('/api/wallets', invalidWallet);
      const duration = Date.now() - startTime;
      
      if (response.error && response.error.includes('必需的')) {
        this.result.addResult(
          '无效钱包数据验证',
          'PASS',
          `正确拒绝无效钱包数据`,
          duration
        );
        colorLog('✅ 无效钱包数据被正确拒绝', 'green');
      } else {
        throw new Error('应该拒绝无效钱包数据');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '无效钱包数据验证',
        'FAIL',
        `无效数据验证失败: ${error}`,
        duration
      );
      colorLog('❌ 无效数据验证失败', 'red');
    }
  }
}

// 运行测试的主函数
export async function runWalletTests(): Promise<void> {
  const test = new WalletTest();
  await test.runAllTests();
}

// 如果直接运行此文件
if (require.main === module) {
  runWalletTests().catch(console.error);
}
