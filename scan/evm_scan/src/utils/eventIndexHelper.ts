import logger from './logger';

/**
 * 事件索引助手 - 用于处理同一交易中的多个事件索引
 */
export class EventIndexHelper {
  private static eventCounters = new Map<string, number>();

  /**
   * 获取或生成事件索引
   * @param txHash 交易哈希
   * @param logIndex 日志索引（来自区块链）
   * @param reset 是否重置计数器（处理新交易时）
   */
  static getEventIndex(txHash: string, logIndex?: number, reset: boolean = false): number {
    if (reset) {
      this.eventCounters.delete(txHash);
    }

    // 如果有真实的logIndex，直接使用
    if (logIndex !== undefined && logIndex !== null) {
      return logIndex;
    }

    // 否则为该交易生成递增的索引
    const currentCount = this.eventCounters.get(txHash) || 0;
    const eventIndex = currentCount;
    this.eventCounters.set(txHash, currentCount + 1);

    logger.debug('生成事件索引', {
      txHash,
      eventIndex,
      logIndex,
      isGenerated: logIndex === undefined
    });

    return eventIndex;
  }

  /**
   * 重置特定交易的事件计数器
   */
  static resetTransactionCounter(txHash: string): void {
    this.eventCounters.delete(txHash);
  }

  /**
   * 清理旧的事件计数器（避免内存泄漏）
   */
  static cleanup(): void {
    this.eventCounters.clear();
    logger.debug('事件索引计数器已清理');
  }

  /**
   * 获取当前计数器状态（用于调试）
   */
  static getCounterStats(): { totalTransactions: number; counters: Record<string, number> } {
    return {
      totalTransactions: this.eventCounters.size,
      counters: Object.fromEntries(this.eventCounters)
    };
  }

  /**
   * 为Credit生成复合引用ID（确保唯一性）
   */
  static generateCreditReferenceId(txHash: string, eventIndex: number): string {
    return `${txHash}_${eventIndex}`;
  }

  /**
   * 解析Credit引用ID
   */
  static parseCreditReferenceId(referenceId: string): { txHash: string; eventIndex: number } | null {
    const parts = referenceId.split('_');
    if (parts.length !== 2) {
      return null;
    }

    const eventIndex = parseInt(parts[1], 10);
    if (isNaN(eventIndex)) {
      return null;
    }

    return {
      txHash: parts[0],
      eventIndex
    };
  }
}

/**
 * 事件索引管理器 - 用于批量处理时的索引管理
 */
export class EventIndexManager {
  private transactionEvents = new Map<string, Array<{
    logIndex: number;
    tokenAddress?: string;
    userId: number;
    amount: string;
  }>>();

  /**
   * 添加事件到交易
   */
  addEvent(txHash: string, event: {
    logIndex: number;
    tokenAddress?: string;
    userId: number;
    amount: string;
  }): void {
    if (!this.transactionEvents.has(txHash)) {
      this.transactionEvents.set(txHash, []);
    }
    
    const events = this.transactionEvents.get(txHash)!;
    events.push(event);
    
    // 按logIndex排序
    events.sort((a, b) => a.logIndex - b.logIndex);
  }

  /**
   * 获取交易的所有事件（按logIndex排序）
   */
  getTransactionEvents(txHash: string): Array<{
    logIndex: number;
    tokenAddress?: string;
    userId: number;
    amount: string;
    eventIndex: number; // 在该交易中的顺序索引
  }> {
    const events = this.transactionEvents.get(txHash) || [];
    
    return events.map((event, index) => ({
      ...event,
      eventIndex: index // 在该交易中的顺序索引
    }));
  }

  /**
   * 清理交易事件记录
   */
  clearTransaction(txHash: string): void {
    this.transactionEvents.delete(txHash);
  }

  /**
   * 清理所有事件记录
   */
  clearAll(): void {
    this.transactionEvents.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalTransactions: number;
    totalEvents: number;
    averageEventsPerTx: number;
  } {
    const totalTransactions = this.transactionEvents.size;
    const totalEvents = Array.from(this.transactionEvents.values())
      .reduce((sum, events) => sum + events.length, 0);
    
    return {
      totalTransactions,
      totalEvents,
      averageEventsPerTx: totalTransactions > 0 ? totalEvents / totalTransactions : 0
    };
  }
}
