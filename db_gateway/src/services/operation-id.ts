import { DatabaseService } from './database';
import { logger } from '../utils/logger';

/**
 * Operation ID管理服务
 * 使用operation_id作为nonce，用于防止重放攻击
 * 确保每个operation_id只能使用一次
 */
export class OperationIdService {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  /**
   * 验证并记录operation_id（作为nonce使用）
   * @param operationId 操作ID（同时作为nonce）
   * @param timestamp 时间戳
   * @returns 如果operation_id有效（未被使用）返回true，否则返回false
   */
  async validateAndRecordOperationId(
    operationId: string,
    timestamp: number
  ): Promise<boolean> {
    try {
      // 检查数据库中是否已存在
      const existing = await this.dbService.queryOne<{ operation_id: string }>(
        'SELECT operation_id FROM used_operation_ids WHERE operation_id = ?',
        [operationId]
      );

      if (existing) {
        logger.warn('Operation ID already used', { operationId });
        return false;
      }

      // 记录operation_id到数据库
      const usedAt = Date.now();
      await this.dbService.run(
        `INSERT INTO used_operation_ids (operation_id, used_at, expires_at)
         VALUES (?, ?, ?)`,
        [operationId, usedAt, usedAt]
      );

      logger.info('Operation ID validated and recorded', { operationId });
      return true;
    } catch (error) {
      logger.error('Operation ID validation failed', { operationId, error, stack: error instanceof Error ? error.stack : undefined });
      return false;
    }
  }

  /**
   * 检查operation_id是否已被使用
   * @param operationId 操作ID
   * @returns 如果已使用返回true
   */
  async isOperationIdUsed(operationId: string): Promise<boolean> {
    const existing = await this.dbService.queryOne<{ operation_id: string }>(
      'SELECT operation_id FROM used_operation_ids WHERE operation_id = ?',
      [operationId]
    );

    return !!existing;
  }

  /**
   * 获取operation_id统计信息
   */
  async getStats(): Promise<{ dbCount: number }> {
    const result = await this.dbService.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM used_operation_ids'
    );

    return {
      dbCount: result?.count || 0
    };
  }
}
