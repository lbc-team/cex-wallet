import { DatabaseService } from './database';
import { logger } from '../utils/logger';

/**
 * Operation ID管理服务
 * 使用operation_id作为nonce，用于防止重放攻击
 * 确保每个operation_id只能使用一次
 */
export class OperationIdService {
  private dbService: DatabaseService;
  private memoryCache: Map<string, number> = new Map();
  private readonly NONCE_EXPIRY_MS = 5 * 60 * 1000; // 5分钟过期

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
      // 1. 检查内存缓存（快速路径）
      if (this.memoryCache.has(operationId)) {
        logger.warn('Operation ID already used (memory cache)', { operationId });
        return false;
      }

      // 2. 检查数据库
      const existing = await this.dbService.queryOne<{ operation_id: string }>(
        'SELECT operation_id FROM used_operation_ids WHERE operation_id = ?',
        [operationId]
      );

      if (existing) {
        logger.warn('Operation ID already used (database)', { operationId });
        return false;
      }

      // 3. 记录operation_id到数据库
      const usedAt = Date.now();
      const expiresAt = usedAt + this.NONCE_EXPIRY_MS;

      await this.dbService.run(
        `INSERT INTO used_operation_ids (operation_id, used_at, expires_at)
         VALUES (?, ?, ?)`,
        [operationId, usedAt, expiresAt]
      );

      // 4. 添加到内存缓存
      this.memoryCache.set(operationId, expiresAt);

      logger.info('Operation ID validated and recorded', { operationId });
      return true;
    } catch (error) {
      logger.error('Operation ID validation failed', { operationId, error });
      return false;
    }
  }

  /**
   * 检查operation_id是否已被使用
   * @param operationId 操作ID
   * @returns 如果已使用返回true
   */
  async isOperationIdUsed(operationId: string): Promise<boolean> {
    // 先检查内存缓存
    if (this.memoryCache.has(operationId)) {
      return true;
    }

    // 再检查数据库
    const existing = await this.dbService.queryOne<{ operation_id: string }>(
      'SELECT operation_id FROM used_operation_ids WHERE operation_id = ?',
      [operationId]
    );

    return !!existing;
  } 


  /**
   * 获取operation_id统计信息
   */
  async getStats(): Promise<{ dbCount: number; memoryCount: number }> {
    const result = await this.dbService.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM used_operation_ids'
    );

    return {
      dbCount: result?.count || 0,
      memoryCount: this.memoryCache.size
    };
  }
}
