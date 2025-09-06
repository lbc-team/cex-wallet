import { 
  HttpClient, 
  TestResult, 
  colorLog, 
  delay 
} from './test-utils';

// Signer 模块测试类
export class SignerTest {
  private client: HttpClient;
  private result: TestResult;

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.client = new HttpClient(baseUrl);
    this.result = new TestResult();
  }

  // 运行所有测试
  async runAllTests(): Promise<void> {
    colorLog('\n🚀 开始 Signer 模块 API 测试...', 'cyan');
    
    try {
      await this.testServerHealth();
      await this.testCreateWallet();
      await this.testCreateMultipleWallets();
      await this.testGetAddresses();
      await this.testInvalidChainType();
      
      this.result.printSummary();
    } catch (error) {
      colorLog(`❌ 测试执行失败: ${error}`, 'red');
    }
  }

  // 测试服务器健康状态
  private async testServerHealth(): Promise<void> {
    const startTime = Date.now();
    try {
      const response = await this.client.get('/health');
      const duration = Date.now() - startTime;
      
      if (response.data && response.data.timestamp) {
        this.result.addResult(
          'Signer 服务器健康检查',
          'PASS',
          `服务器正常运行 - ${response.message}`,
          duration
        );
        colorLog('✅ Signer 服务器健康检查通过', 'green');
      } else {
        throw new Error('响应格式不正确');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        'Signer 服务器健康检查',
        'FAIL',
        `服务器连接失败: ${error}`,
        duration
      );
      colorLog('❌ Signer 服务器健康检查失败', 'red');
    }
  }

  // 测试创建钱包
  private async testCreateWallet(): Promise<void> {
    const startTime = Date.now();
    try {
      const createRequest = {
        chainType: 'evm',
        device: 'test-device-1'
      };
      
      const response = await this.client.post('/api/signer/create', createRequest);
      const duration = Date.now() - startTime;
      
      if (response.success && response.data) {
        this.result.addResult(
          '创建钱包',
          'PASS',
          `钱包创建成功 - 地址: ${response.data.address}`,
          duration
        );
        colorLog(`✅ 钱包创建成功 - 地址: ${response.data.address}`, 'green');
        colorLog(`   设备: ${response.data.device}`, 'blue');
        colorLog(`   路径: ${response.data.path}`, 'blue');
        colorLog(`   链类型: ${response.data.chainType}`, 'blue');
        
        // 保存钱包信息供后续测试使用
        (this as any).firstWallet = response.data;
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

  // 测试创建多个钱包（验证路径递增）
  private async testCreateMultipleWallets(): Promise<void> {
    const startTime = Date.now();
    try {
      const createRequest = {
        chainType: 'evm',
        device: 'test-device-2'
      };
      
      const response = await this.client.post('/api/signer/create', createRequest);
      const duration = Date.now() - startTime;
      
      if (response.success && response.data) {
        const firstWallet = (this as any).firstWallet;
        if (firstWallet && firstWallet.path !== response.data.path) {
          this.result.addResult(
            '创建多个钱包',
            'PASS',
            `第二个钱包创建成功，路径已递增`,
            duration
          );
          colorLog(`✅ 第二个钱包创建成功 - 地址: ${response.data.address}`, 'green');
          colorLog(`   第一个钱包路径: ${firstWallet.path}`, 'blue');
          colorLog(`   第二个钱包路径: ${response.data.path}`, 'blue');
          
          // 保存第二个钱包信息
          (this as any).secondWallet = response.data;
        } else {
          throw new Error('路径没有正确递增');
        }
      } else {
        throw new Error('第二个钱包创建失败');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '创建多个钱包',
        'FAIL',
        `创建多个钱包失败: ${error}`,
        duration
      );
      colorLog('❌ 创建多个钱包失败', 'red');
    }
  }

  // 测试获取地址列表
  private async testGetAddresses(): Promise<void> {
    const startTime = Date.now();
    try {
      const response = await this.client.get('/api/signer/addresses');
      const duration = Date.now() - startTime;
      
      if (response.success && response.data && response.data.addresses) {
        const addresses = response.data.addresses;
        this.result.addResult(
          '获取地址列表',
          'PASS',
          `获取到 ${addresses.length} 个地址，当前索引: ${response.data.currentIndex}`,
          duration
        );
        colorLog(`✅ 获取地址列表成功 - 共 ${addresses.length} 个地址`, 'green');
        colorLog(`   当前索引: ${response.data.currentIndex}`, 'blue');
        
        // 验证地址列表包含我们创建的钱包
        const firstWallet = (this as any).firstWallet;
        const secondWallet = (this as any).secondWallet;
        
        if (firstWallet && addresses.some((addr: any) => addr.address === firstWallet.address)) {
          colorLog(`   ✅ 第一个钱包地址在列表中`, 'green');
        }
        
        if (secondWallet && addresses.some((addr: any) => addr.address === secondWallet.address)) {
          colorLog(`   ✅ 第二个钱包地址在列表中`, 'green');
        }
      } else {
        throw new Error('地址列表格式不正确');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '获取地址列表',
        'FAIL',
        `获取地址列表失败: ${error}`,
        duration
      );
      colorLog('❌ 获取地址列表失败', 'red');
    }
  }

  // 测试无效链类型
  private async testInvalidChainType(): Promise<void> {
    const startTime = Date.now();
    try {
      const invalidRequest = {
        chainType: 'invalid-chain',
        device: 'test-device'
      };
      
      const response = await this.client.post('/api/signer/create', invalidRequest);
      const duration = Date.now() - startTime;
      
      if (!response.success && response.error && response.error.includes('不支持的链类型')) {
        this.result.addResult(
          '无效链类型验证',
          'PASS',
          `正确拒绝无效链类型`,
          duration
        );
        colorLog('✅ 无效链类型被正确拒绝', 'green');
      } else {
        throw new Error('应该拒绝无效链类型');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.result.addResult(
        '无效链类型验证',
        'FAIL',
        `无效链类型验证失败: ${error}`,
        duration
      );
      colorLog('❌ 无效链类型验证失败', 'red');
    }
  }
}

// 运行测试的主函数
export async function runSignerTests(): Promise<void> {
  const test = new SignerTest();
  await test.runAllTests();
}

// 导出测试运行函数供外部调用
export { runSignerTests };
