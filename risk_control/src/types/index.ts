// 风控评估请求
export interface RiskAssessmentRequest {
  operation_id: string;  // 由业务层生成的唯一操作ID
  event_type: 'deposit' | 'withdraw' | 'transfer' | 'other';
  operation_type: 'read' | 'write' | 'sensitive';
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete';
  data?: any;
  conditions?: any;
  module: 'wallet' | 'scan';

  // 业务相关信息（用于风控决策）
  user_id?: number;
  amount?: string;
  from_address?: string;
  to_address?: string;
  tx_hash?: string;
  token_id?: number;
  metadata?: any;
}

// 风控决策类型
export type RiskDecision = 'approve' | 'freeze' | 'reject' | 'manual_review';

// 风控评估响应
export interface RiskAssessmentResponse {
  success: boolean;
  decision: RiskDecision;
  operation_id: string;  // 原样返回业务层传入的 operation_id

  // 数据库操作（如果批准）
  db_operation: {
    table: string;
    action: 'select' | 'insert' | 'update' | 'delete';
    data?: any;
    conditions?: any;
  };

  // 风控签名
  risk_signature: string;
  timestamp: number;

  // 风控评估详情
  risk_level?: 'low' | 'medium' | 'high' | 'critical';
  risk_score?: number;
  reasons?: string[];

  // 错误信息（如果失败）
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

// 签名负载（与 db_gateway 保持一致）
export interface SignaturePayload {
  operation_id: string;
  operation_type: string;
  table: string;
  action: string;
  data?: any;
  conditions?: any;
  timestamp: number;
  module: string;
}

// 黑名单地址（模拟）
export interface BlacklistAddress {
  address: string;
  reason: string;
  added_at: number;
}

// 风控规则（模拟）
export interface RiskRule {
  id: string;
  name: string;
  type: 'blacklist' | 'amount_limit' | 'frequency_limit' | 'custom';
  enabled: boolean;
  config: any;
}
