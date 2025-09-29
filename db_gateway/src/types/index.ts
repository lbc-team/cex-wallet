export interface GatewayRequest {
  operation_id: string;
  operation_type: 'read' | 'write' | 'sensitive';
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete';
  data?: any;
  conditions?: any;
  business_signature: string;
  risk_control_signature?: string;
  timestamp: number;
  module: 'wallet' | 'scan';
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
  audit_log_id: string;
}

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

export interface AuditLog {
  id: string;
  operation_id: string;
  operation_type: string;
  table_name: string;
  action: string;
  module: string;
  data_before?: any;
  data_after?: any;
  business_signer: string;
  risk_control_signer?: string;
  ip_address: string;
  user_agent: string;
  timestamp: number;
  result: 'success' | 'failed';
  error_message?: string;
  created_at: Date;
}

export interface ModulePublicKeys {
  wallet: string;
  scan: string;
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