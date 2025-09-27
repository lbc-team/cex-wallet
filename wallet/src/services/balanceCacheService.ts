import { DatabaseConnection } from '../db/connection';
import { normalizeBigIntString } from '../utils/numberUtils';

/**
 * 余额缓存服务 - 管理user_balance_cache表，优化高频查询性能
 */
export class BalanceCacheService {
  private db: DatabaseConnection;
  private cacheUpdateThreshold = 10; // 缓存更新阈值：当credits新增10条记录时更新缓存

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  /**
   * 获取用户余额（优先从缓存，必要时实时计算）
   */
  async getUserBalances(userId: number, tokenId?: number): Promise<{
    token_id: number;
    token_symbol: string;
    available_balance: string;
    frozen_balance: string;
    total_balance: string;
    available_balance_formatted: string;
    frozen_balance_formatted: string;
    total_balance_formatted: string;
    is_cached: boolean;
  }[]> {
    try {
      // 1. 先尝试从缓存获取
      let cacheQuery = 'SELECT * FROM user_balance_cache WHERE user_id = ?';
      const cacheParams: any[] = [userId];

      if (tokenId) {
        cacheQuery += ' AND token_id = ?';
        cacheParams.push(tokenId);
      }

      const cachedBalances = await this.db.query(cacheQuery, cacheParams);

      // 2. 检查缓存是否需要更新
      const needsUpdate = await this.checkCacheNeedsUpdate(userId, cachedBalances);

      if (!needsUpdate && cachedBalances.length > 0) {
        // 使用缓存数据
        return cachedBalances.map((cache: any) => ({
          token_id: cache.token_id,
          token_symbol: cache.token_symbol,
          available_balance: cache.available_balance,
          frozen_balance: cache.frozen_balance,
          total_balance: cache.total_balance,
          available_balance_formatted: this.formatBalance(cache.available_balance, 18), // 简化处理
          frozen_balance_formatted: this.formatBalance(cache.frozen_balance, 18),
          total_balance_formatted: this.formatBalance(cache.total_balance, 18),
          is_cached: true
        }));
      }

      // 3. 实时计算并更新缓存
      const realTimeBalances = await this.calculateRealTimeBalances(userId, tokenId);
      await this.updateCache(userId, realTimeBalances);

      return realTimeBalances.map(balance => ({
        ...balance,
        is_cached: false
      }));

    } catch (error) {
      console.error('获取用户余额失败', { userId, tokenId, error });
      throw error;
    }
  }

  /**
   * 检查缓存是否需要更新
   */
  private async checkCacheNeedsUpdate(userId: number, cachedBalances: any[]): Promise<boolean> {
    if (cachedBalances.length === 0) {
      return true; // 没有缓存数据，需要更新
    }

    // 获取最新的credit ID
    const latestCredit = await this.db.queryOne(
      'SELECT MAX(id) as max_id FROM credits WHERE user_id = ?',
      [userId]
    );

    if (!latestCredit || !latestCredit.max_id) {
      return false; // 没有credit记录，不需要更新
    }

    // 检查缓存的最后更新点
    const maxLastCreditId = Math.max(...cachedBalances.map((cache: any) => cache.last_credit_id || 0));
    
    // 如果有新的credit记录，且数量超过阈值，则需要更新
    const newCreditsCount = latestCredit.max_id - maxLastCreditId;
    return newCreditsCount >= this.cacheUpdateThreshold;
  }

  /**
   * 实时计算用户余额
   */
  private async calculateRealTimeBalances(userId: number, tokenId?: number): Promise<{
    token_id: number;
    token_symbol: string;
    available_balance: string;
    frozen_balance: string;
    total_balance: string;
    available_balance_formatted: string;
    frozen_balance_formatted: string;
    total_balance_formatted: string;
    decimals: number;
  }[]> {
    let sql = `
      SELECT 
        token_id,
        token_symbol,
        decimals,
        total_available_balance as available_balance,
        total_frozen_balance as frozen_balance,
        total_balance,
        total_available_formatted as available_balance_formatted,
        total_frozen_formatted as frozen_balance_formatted,
        total_balance_formatted
      FROM v_user_token_totals 
      WHERE user_id = ?
    `;

    const params: any[] = [userId];

    if (tokenId) {
      sql += ' AND token_id = ?';
      params.push(tokenId);
    }

    sql += ' ORDER BY total_balance DESC';

    const rows = await this.db.query(sql, params);
    
    return rows.map((row: any) => ({
      token_id: row.token_id,
      token_symbol: row.token_symbol,
      available_balance: row.available_balance.toString(),
      frozen_balance: row.frozen_balance.toString(),
      total_balance: row.total_balance.toString(),
      available_balance_formatted: row.available_balance_formatted,
      frozen_balance_formatted: row.frozen_balance_formatted,
      total_balance_formatted: row.total_balance_formatted,
      decimals: row.decimals
    }));
  }

  /**
   * 更新缓存
   */
  private async updateCache(userId: number, balances: any[]): Promise<void> {
    try {
      // 获取最新的credit ID
      const latestCredit = await this.db.queryOne(
        'SELECT MAX(id) as max_id FROM credits WHERE user_id = ?',
        [userId]
      );

      const lastCreditId = latestCredit?.max_id || 0;

      // 删除旧缓存
      await this.db.run('DELETE FROM user_balance_cache WHERE user_id = ?', [userId]);

      // 插入新缓存
      for (const balance of balances) {
        if (parseFloat(balance.total_balance) > 0) {
          await this.db.run(
            `INSERT INTO user_balance_cache (
              user_id, token_id, token_symbol, 
              available_balance, frozen_balance, total_balance, 
              last_credit_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
              userId,
              balance.token_id,
              balance.token_symbol,
              balance.available_balance,
              balance.frozen_balance,
              balance.total_balance,
              lastCreditId
            ]
          );
        }
      }

      console.log('缓存更新完成', { userId, balanceCount: balances.length, lastCreditId });
    } catch (error) {
      console.error('更新缓存失败', { userId, error });
      throw error;
    }
  }

  /**
   * 强制刷新用户缓存
   */
  async refreshUserCache(userId: number): Promise<void> {
    const balances = await this.calculateRealTimeBalances(userId);
    await this.updateCache(userId, balances);
  }

  /**
   * 强制刷新所有用户缓存
   */
  async refreshAllCache(): Promise<void> {
    try {
      console.log('开始刷新所有用户缓存...');

      // 获取所有有余额的用户
      const users = await this.db.query(
        'SELECT DISTINCT user_id FROM credits WHERE status = ? ORDER BY user_id',
        ['finalized']
      );

      let refreshedCount = 0;
      for (const user of users) {
        await this.refreshUserCache(user.user_id);
        refreshedCount++;
      }

      console.log('缓存刷新完成', { refreshedUsers: refreshedCount });
    } catch (error) {
      console.error('刷新所有缓存失败', { error });
      throw error;
    }
  }

  /**
   * 获取缓存统计信息
   */
  async getCacheStats(): Promise<{
    cachedUsers: number;
    cachedTokens: number;
    totalCacheRecords: number;
    oldestCache: string | null;
    newestCache: string | null;
  }> {
    try {
      const stats = await this.db.queryOne(`
        SELECT 
          COUNT(DISTINCT user_id) as cachedUsers,
          COUNT(DISTINCT token_id) as cachedTokens,
          COUNT(*) as totalCacheRecords,
          MIN(updated_at) as oldestCache,
          MAX(updated_at) as newestCache
        FROM user_balance_cache
      `);

      return stats || {
        cachedUsers: 0,
        cachedTokens: 0,
        totalCacheRecords: 0,
        oldestCache: null,
        newestCache: null
      };
    } catch (error) {
      console.error('获取缓存统计失败', { error });
      throw error;
    }
  }

  /**
   * 清理过期缓存
   */
  async cleanExpiredCache(maxAgeHours: number = 24): Promise<number> {
    try {
      const result = await this.db.run(
        `DELETE FROM user_balance_cache 
         WHERE updated_at < datetime('now', '-${maxAgeHours} hours')`
      );

      const deletedCount = result.changes || 0;
      console.log('清理过期缓存完成', { deletedCount, maxAgeHours });
      
      return deletedCount;
    } catch (error) {
      console.error('清理过期缓存失败', { error });
      throw error;
    }
  }


  /**
   * 格式化余额（简化版本）
   */
  private formatBalance(balance: string, decimals: number = 18): string {
    try {
      const normalizedBalance = normalizeBigIntString(balance);
      const value = BigInt(normalizedBalance);
      const divisor = BigInt(10 ** decimals);
      const integerPart = value / divisor;
      const fractionalPart = value % divisor;
      
      const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
      const truncatedFractional = fractionalStr.slice(0, 6).padEnd(6, '0');
      
      return `${integerPart}.${truncatedFractional}`;
    } catch (error) {
      console.error('格式化余额失败', { balance, decimals, error });
      return '0.000000';
    }
  }

  /**
   * 设置缓存更新阈值
   */
  setCacheUpdateThreshold(threshold: number): void {
    this.cacheUpdateThreshold = threshold;
  }
}
