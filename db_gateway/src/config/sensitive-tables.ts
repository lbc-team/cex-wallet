/**
 * 敏感表配置
 * 定义哪些表的哪些操作需要风控签名
 */

export interface SensitiveTableConfig {
  table: string;
  actions: ('insert' | 'update' | 'delete' | 'select')[];
  reason: string;
}

/**
 * 敏感表列表
 * 对这些表的指定操作必须使用 operation_type: 'sensitive' 并提供 risk_signature
 */
export const SENSITIVE_TABLES: SensitiveTableConfig[] = [
  {
    table: 'credits',
    actions: ['insert', 'update', 'delete'],
    reason: 'Credits table contains user balance information'
  },
  {
    table: 'withdraws',
    actions: ['insert', 'update'],
    reason: 'Withdraw operations require risk control'
  },
];

/**
 * 检查操作是否需要风控签名
 */
export function isSensitiveOperation(
  table: string,
  action: 'insert' | 'update' | 'delete' | 'select'
): boolean {
  return SENSITIVE_TABLES.some(
    config => config.table === table && config.actions.includes(action)
  );
}

/**
 * 获取敏感操作的原因
 */
export function getSensitiveReason(table: string): string | null {
  const config = SENSITIVE_TABLES.find(c => c.table === table);
  return config ? config.reason : null;
}
