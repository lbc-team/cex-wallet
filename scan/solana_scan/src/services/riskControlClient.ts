/**
 * Risk Control Client Service
 * 与独立风控服务交互，获取敏感数据库操作所需的风控签名
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
    action: 'select' | 'insert' | 'update' | 'delete';
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
   * 请求风控评估，并返回风控签名
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

    const response = await fetch(`${this.riskControlUrl}/api/assess`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(riskRequest)
    });

    const result = await response.json() as any;

    // 对于 202 (manual review) 和 403 (reject) 仍然返回响应，方便业务层处理
    if (!response.ok && response.status !== 202 && response.status !== 403) {
      const message = result?.error?.message || result?.message || '风控评估失败';
      throw new Error(`风控评估失败: ${response.status} - ${message}`);
    }

    return result as RiskAssessmentResponse;
  }

  /**
   * 根据表和操作提取风控上下文信息
   */
  private extractRiskContext(table: string, action: string, data?: any): Record<string, any> {
    if (!data) {
      return {};
    }

    const context: Record<string, any> = {};

    if (table === 'credits') {
      if (data.user_id) context.user_id = data.user_id;
      if (data.amount) context.amount = data.amount;
      if (data.token_id) context.token_id = data.token_id;
      if (data.token_symbol) context.token_symbol = data.token_symbol;
      if (data.credit_type) context.credit_type = data.credit_type;
      if (data.business_type) context.business_type = data.business_type;
      if (data.tx_hash) context.tx_hash = data.tx_hash;
      if (data.address) context.from_address = data.address;
      if (data.chain_id) context.chain_id = data.chain_id;
      if (data.chain_type) context.chain_type = data.chain_type;

      if (data.metadata) {
        try {
          const metadata = typeof data.metadata === 'string' ? JSON.parse(data.metadata) : data.metadata;
          if (metadata?.from_address && !context.from_address) {
            context.from_address = metadata.from_address;
          }
          if (metadata?.to_address) {
            context.to_address = metadata.to_address;
          }
        } catch {
          // 忽略 metadata 解析失败
        }
      }
    } else if (table === 'withdraws') {
      if (data.user_id) context.user_id = data.user_id;
      if (data.to_address) context.to_address = data.to_address;
      if (data.amount) context.amount = data.amount;
      if (data.token_id) context.token_id = data.token_id;
      context.credit_type = 'withdraw';
    }

    if (data.from_address && !context.from_address) {
      context.from_address = data.from_address;
    }
    if (data.to_address && !context.to_address) {
      context.to_address = data.to_address;
    }

    return context;
  }

  /**
   * 风控服务健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.riskControlUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        return false;
      }

      const health = await response.json() as { success?: boolean };
      return health.success === true;
    } catch {
      return false;
    }
  }
}

let riskControlClient: RiskControlClient | null = null;

export function getRiskControlClient(): RiskControlClient {
  if (!riskControlClient) {
    riskControlClient = new RiskControlClient();
  }
  return riskControlClient;
}
