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

    if (!riskResponse.ok) {
      const errorData = await riskResponse.json().catch(() => ({})) as any;
      throw new Error(`风控评估失败: ${riskResponse.status} - ${errorData.error?.message || '评估失败'}`);
    }

    const riskResult = await riskResponse.json() as RiskAssessmentResponse;

    if (!riskResult.success) {
      throw new Error(`风控评估被拒绝: ${riskResult.decision} - ${riskResult.reasons?.join(', ') || '未通过风控'}`);
    }

    return riskResult;
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
      if (data.token_id) context.token_id = data.token_id;
      if (data.token_symbol) context.token_symbol = data.token_symbol;
      if (data.credit_type) context.credit_type = data.credit_type;
      if (data.business_type) context.business_type = data.business_type;
      if (data.tx_hash) context.tx_hash = data.tx_hash;
      if (data.address) context.address = data.address;
      if (data.chain_id) context.chain_id = data.chain_id;
      if (data.chain_type) context.chain_type = data.chain_type;

      // 从 metadata 中提取更多信息
      if (data.metadata) {
        try {
          const metadata = typeof data.metadata === 'string'
            ? JSON.parse(data.metadata)
            : data.metadata;
          if (metadata.from_address) context.from_address = metadata.from_address;
          if (metadata.to_address) context.to_address = metadata.to_address;
        } catch (error) {
          // metadata 解析失败，忽略
        }
      }
    } else if (table === 'withdraws') {
      // 提现记录相关字段
      if (data.user_id) context.user_id = data.user_id;
      if (data.to_address) context.to_address = data.to_address;
      if (data.amount) context.amount = data.amount;
      if (data.token_id) context.token_id = data.token_id;
    } else if (table === 'users') {
      // 用户相关字段
      if (data.id) context.user_id = data.id;
      if (data.status) context.user_status = data.status;
      if (data.kyc_status) context.kyc_status = data.kyc_status;
    }

    // 通用字段：从 data 中提取所有常见的风控字段
    // 这样即使是其他表，也能提取到风控需要的信息
    if (data.from_address && !context.from_address) {
      context.from_address = data.from_address;
    }
    if (data.to_address && !context.to_address) {
      context.to_address = data.to_address;
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
