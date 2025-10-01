export interface GatewayRequest {
  operation_id: string;  // 同时作为防重放攻击的nonce
  operation_type: 'read' | 'write' | 'sensitive';
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete';
  data?: any;
  conditions?: any;
  business_signature: string;
  risk_signature?: string;  // 风控签名（敏感操作必需）
  timestamp: number;
}

export interface GatewayResponse {
  success: boolean;
  operation_id: string;
  data?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  audit_log_id?: string;
}

export interface BatchOperation {
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete';
  data?: any;
  conditions?: any;
}

export interface BatchGatewayRequest {
  operation_id: string;  // 同时作为防重放攻击的nonce
  operation_type: 'read' | 'write' | 'sensitive';
  operations: BatchOperation[];
  business_signature: string;
  risk_signature?: string;  // 风控签名（敏感操作必需）
  timestamp: number;
}

export interface BatchGatewayResponse {
  success: boolean;
  operation_id: string;
  results?: any[];
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface SignaturePayload {
  operation_id: string;
  operation_type: string;
  table: string;
  action: string;
  data?: any;
  conditions?: any;
  timestamp: number;
}


export interface ModulePublicKeys {
  wallet: string;
  scan: string;
  risk: string;  // 风控系统公钥
}

export enum OperationType {
  READ = 'read',
  WRITE = 'write',
  SENSITIVE = 'sensitive'
}

export enum DatabaseAction {
  SELECT = 'select',
  INSERT = 'insert',
  UPDATE = 'update',
  DELETE = 'delete'
}