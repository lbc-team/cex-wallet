// 风控评估请求
export interface RiskAssessmentRequest {
  operation_id: string;  // 由业务层生成的唯一操作ID
  operation_type: 'read' | 'write' | 'sensitive';
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete';
  data?: any;
  conditions?: any;
  timestamp: number;  // 由业务层生成的时间戳，确保业务签名和风控签名使用相同的时间戳

  // 业务上下文（用于风控决策）- 灵活的key-value结构
  // 不同业务场景可以传入不同的字段，风控系统根据需要提取
  // 推荐字段：
  // - credit_type: 'deposit' | 'withdraw' | 'transfer' (用于 credits 表)
  // - business_type: 更细粒度的业务类型描述
  // - user_id, amount, from_address, to_address 等业务字段
  context?: Record<string, any>;
}

// 风控决策类型
export type RiskDecision = 'approve' | 'freeze' | 'reject' | 'manual_review';

// 风控评估响应
export interface RiskAssessmentResponse {
  success: boolean;
  decision: RiskDecision;
  operation_id: string;  // 原样返回业务层传入的 operation_id

  // 数据库操作（如果批准或有建议数据）
  db_operation: {
    table: string;
    action: 'select' | 'insert' | 'update' | 'delete';
    data?: any;
    conditions?: any;
  };

  // 风控建议（可选，用于 deny 决策时提供修改建议）
  suggest_operation_data?: any;
  suggest_reason?: string;

  // 风控签名
  risk_signature: string;
  timestamp: number;  // 原样返回业务层传入的 timestamp

  // 风控评估详情
  risk_level?: 'low' | 'medium' | 'high' | 'critical';
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
}

// 黑名单地址（模拟）
export interface BlacklistAddress {
  address: string;
  reason: string;
  added_at: number;
}
