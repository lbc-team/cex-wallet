/**
 * 数值处理工具函数
 */

/**
 * 标准化 BigInt 字符串，处理科学计数法格式
 * @param value 需要标准化的字符串
 * @returns 标准化后的整数字符串
 */
export function normalizeBigIntString(value: string): string {
  // 如果包含科学计数法 (e 或 E)
  if (value.includes('e') || value.includes('E')) {
    // 转换为数字再转回字符串，避免科学计数法
    const num = parseFloat(value);
    if (isNaN(num)) {
      return '0';
    }
    // 使用 toFixed(0) 确保返回整数格式
    return num.toFixed(0);
  }
  return value;
}

/**
 * 安全地将字符串转换为 BigInt
 * @param value 需要转换的字符串
 * @returns BigInt 值
 */
export function safeBigInt(value: string): bigint {
  const normalized = normalizeBigIntString(value);
  return BigInt(normalized);
}

/**
 * 比较两个 BigInt 字符串的大小
 * @param a 第一个值
 * @param b 第二个值
 * @returns 比较结果：-1 (a < b), 0 (a = b), 1 (a > b)
 */
export function compareBigIntStrings(a: string, b: string): number {
  const bigIntA = safeBigInt(a);
  const bigIntB = safeBigInt(b);
  
  if (bigIntA < bigIntB) return -1;
  if (bigIntA > bigIntB) return 1;
  return 0;
}

/**
 * 检查第一个 BigInt 字符串是否大于等于第二个
 * @param a 第一个值
 * @param b 第二个值
 * @returns 是否大于等于
 */
export function isBigIntStringGreaterOrEqual(a: string, b: string): boolean {
  return safeBigInt(a) >= safeBigInt(b);
}

/**
 * 标准化数值，避免科学计数法（用于数据库查询结果）
 * @param value 需要标准化的数值
 * @returns 标准化后的整数字符串
 */
export function normalizeValue(value: number): string {
  if (value === 0) return '0';
  // 使用 toFixed(0) 确保返回整数格式，避免科学计数法
  const result = value.toFixed(0);
  return result;
}
