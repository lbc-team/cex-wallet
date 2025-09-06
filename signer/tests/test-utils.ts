// Signer 模块测试工具函数

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

// HTTP请求工具
export class HttpClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  async get<T = any>(path: string): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`);
      const text = await response.text();
      console.log(`GET ${path} - Status: ${response.status}, Response: ${text}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      
      try {
        return JSON.parse(text) as ApiResponse<T>;
      } catch (parseError) {
        throw new Error(`响应格式不正确: ${text}`);
      }
    } catch (error) {
      throw new Error(`GET请求失败: ${error}`);
    }
  }

  async post<T = any>(path: string, data: any): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      const text = await response.text();
      console.log(`POST ${path} - Status: ${response.status}, Response: ${text}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      
      try {
        return JSON.parse(text) as ApiResponse<T>;
      } catch (parseError) {
        throw new Error(`响应格式不正确: ${text}`);
      }
    } catch (error) {
      throw new Error(`POST请求失败: ${error}`);
    }
  }

  async put<T = any>(path: string, data: any): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      const text = await response.text();
      console.log(`PUT ${path} - Status: ${response.status}, Response: ${text}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      
      try {
        return JSON.parse(text) as ApiResponse<T>;
      } catch (parseError) {
        throw new Error(`响应格式不正确: ${text}`);
      }
    } catch (error) {
      throw new Error(`PUT请求失败: ${error}`);
    }
  }
}

// 测试结果记录
export class TestResult {
  private results: Array<{
    test: string;
    status: 'PASS' | 'FAIL';
    message: string;
    duration: number;
  }> = [];

  addResult(test: string, status: 'PASS' | 'FAIL', message: string, duration: number) {
    this.results.push({ test, status, message, duration });
  }

  getResults() {
    return this.results;
  }

  getSummary() {
    const total = this.results.length;
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = total - passed;
    
    return {
      total,
      passed,
      failed,
      successRate: total > 0 ? (passed / total * 100).toFixed(2) + '%' : '0%'
    };
  }

  printSummary() {
    console.log('\n=== 测试结果汇总 ===');
    console.log(`总测试数: ${this.getSummary().total}`);
    console.log(`通过: ${this.getSummary().passed}`);
    console.log(`失败: ${this.getSummary().failed}`);
    console.log(`成功率: ${this.getSummary().successRate}`);
    
    console.log('\n=== 详细结果 ===');
    this.results.forEach(result => {
      const status = result.status === 'PASS' ? '✅' : '❌';
      console.log(`${status} ${result.test}: ${result.message} (${result.duration}ms)`);
    });
  }
}

// 延迟函数
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 颜色输出
export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

export function colorLog(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}
