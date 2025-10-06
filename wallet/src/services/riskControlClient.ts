/**
 * Risk Control Client Service
 * 独立的风控服务客户端，封装对风控服务的请求
 */

export interface RiskAssessmentRequest {
  operation_id: string;
  operation_type: 'read' | 'write' | 'sensitive';
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete';
  data?: any;
  conditions?: any;
  timestamp: number;
  context?: Record<string, any>;
}

export interface RiskAssessmentResponse {
  success: boolean;
  decision: string;
  risk_signature: string;
  timestamp: number;
  db_operation?: {
    table: string;
    action: string;
    data?: any;
    conditions?: any;
  };
  reasons?: string[];
}

export class RiskControlClient {
  private riskControlUrl: string;

  constructor(riskControlUrl?: string) {
    this.riskControlUrl = riskControlUrl || process.env.RISK_CONTROL_URL || 'http://localhost:3004';
  }

  /**
   * 请求风控评估
   */
  async requestRiskAssessment(params: RiskAssessmentRequest): Promise<RiskAssessmentResponse> {
    const riskRequest = {
      operation_id: params.operation_id,
      operation_type: params.operation_type,
      table: params.table,
      action: params.action,
      data: params.data,
      conditions: params.conditions,
      timestamp: params.timestamp,
      context: params.context || this.extractRiskContext(params.table, params.action, params.data)
    };

    // 请求风控评估
    const riskResponse = await fetch(`${this.riskControlUrl}/api/assess`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(riskRequest)
    });

    // 风控服务会根据决策返回不同的状态码：
    // - 200: approve/freeze
    // - 202: manual_review
    // - 403: reject
    // 都需要解析响应体获取评估结果
    const riskResult = await riskResponse.json() as any;

    // 只在服务器错误（5xx）或真正的客户端错误（4xx，但排除403和202）时抛出异常
    if (!riskResponse.ok && riskResponse.status !== 403 && riskResponse.status !== 202) {
      const errorMessage = riskResult.error?.message || riskResult.message || '评估失败';
      throw new Error(`风控评估失败: ${riskResponse.status} - ${errorMessage}`);
    }

    return riskResult as RiskAssessmentResponse;
  }

  /**
   * 提取风控上下文信息
   * 根据不同的表和操作类型，提取相关的风控字段
   */
  private extractRiskContext(table: string, action: string, data?: any): Record<string, any> {
    if (!data) return {};

    const context: Record<string, any> = {};

    // 根据表类型提取不同的字段
    if (table === 'credits') {
      // 充值/提现/转账相关字段
      if (data.user_id) context.user_id = data.user_id;
      if (data.amount) context.amount = data.amount;
      if (data.credit_type) context.credit_type = data.credit_type;
      if (data.address) context.from_address = data.address;  // 用户地址作为from_address
      if (data.business_type) context.business_type = data.business_type;
    } else if (table === 'withdraws') {
      // 提现请求相关字段
      if (data.user_id) context.user_id = data.user_id;
      if (data.amount) context.amount = data.amount;
      if (data.to_address) context.to_address = data.to_address;
      // from_address 不需要提取，因为提现时资金是从热钱包出，不是用户钱包
      context.credit_type = 'withdraw';
    }

    return context;
  }

  /**
   * 检查风控服务健康状态
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.riskControlUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000) // 5秒超时
      });

      if (!response.ok) {
        return false;
      }

      const healthData = await response.json() as { success?: boolean };
      return healthData.success === true;
    } catch (error) {
      return false;
    }
  }
}

// 单例实例
let riskControlClient: RiskControlClient | null = null;

/**
 * 获取 RiskControlClient 单例实例
 */
export function getRiskControlClient(): RiskControlClient {
  if (!riskControlClient) {
    riskControlClient = new RiskControlClient();
  }
  return riskControlClient;
}
