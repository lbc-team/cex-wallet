import { database } from './connection';
import { EventIndexHelper } from '../utils/eventIndexHelper';
import logger from '../utils/logger';

// Credit类型枚举（与wallet服务保持一致）
export enum CreditType {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  COLLECT = 'collect',
  REBALANCE = 'rebalance',
  TRADE_BUY = 'trade_buy',
  TRADE_SELL = 'trade_sell',
  TRADE_FEE = 'trade_fee',
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  FREEZE = 'freeze',
  UNFREEZE = 'unfreeze',
  REWARD = 'reward',
  PENALTY = 'penalty',
  LOCK = 'lock'
}

export enum BusinessType {
  BLOCKCHAIN = 'blockchain',
  SPOT_TRADE = 'spot_trade',
  FUTURES_TRADE = 'futures_trade',
  INTERNAL_TRANSFER = 'internal_transfer',
  ADMIN_ADJUST = 'admin_adjust',
  SYSTEM_REWARD = 'system_reward'
}

export interface Credit {
  id?: number;
  user_id: number;
  address: string;
  token_id: number;
  token_symbol: string;
  amount: string;
  credit_type: CreditType;
  business_type: BusinessType;
  reference_id: string;
  reference_type: string;
  status: 'pending' | 'confirmed' | 'finalized' | 'failed';
  block_number?: number;
  tx_hash?: string;
  event_index: number;
  metadata?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Credit数据访问对象 - 用于scan服务
 */
export class CreditDAO {
  /**
   * 创建充值Credit记录（幂等性保证）
   */
  async createDepositCredit(params: {
    userId: number;
    address: string;
    tokenId: number;
    tokenSymbol: string;
    amount: string;
    txHash: string;
    blockNumber: number;
    chainId?: number;
    chainType?: string;
    eventIndex?: number; // 添加事件索引参数
    status?: 'pending' | 'confirmed' | 'finalized';
    metadata?: any;
  }): Promise<number | null> {
    try {
      const result = await database.run(
        `INSERT INTO credits (
          user_id, address, token_id, token_symbol, amount,
          credit_type, business_type, reference_id, reference_type,
          chain_id, chain_type, status, block_number, tx_hash, event_index, metadata,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          params.userId,
          params.address,
          params.tokenId,
          params.tokenSymbol,
          params.amount,
          CreditType.DEPOSIT,
          BusinessType.BLOCKCHAIN,
          EventIndexHelper.generateCreditReferenceId(params.txHash, params.eventIndex || 0),
          'blockchain_tx',
          params.chainId,
          params.chainType,
          params.status || 'confirmed',
          params.blockNumber,
          params.txHash,
          params.eventIndex || 0, // 使用真实的事件索引
          params.metadata ? JSON.stringify(params.metadata) : null
        ]
      );

      logger.debug('创建充值Credit记录', {
        creditId: result.lastID,
        userId: params.userId,
        tokenSymbol: params.tokenSymbol,
        amount: params.amount,
        txHash: params.txHash
      });

      return result.lastID!;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        // 重复处理，返回null表示已存在
        logger.debug('充值Credit记录已存在', {
          txHash: params.txHash,
          userId: params.userId
        });
        return null;
      }
      logger.error('创建充值Credit记录失败', { params, error });
      throw error;
    }
  }

  /**
   * 批量更新Credit状态（通过交易哈希）
   */
  async updateCreditStatusByTxHash(
    txHash: string, 
    status: 'pending' | 'confirmed' | 'finalized' | 'failed'
  ): Promise<void> {
    try {
      await database.run(
        'UPDATE credits SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE tx_hash = ?',
        [status, txHash]
      );
      
      logger.debug('更新Credit状态', { txHash, status });
    } catch (error) {
      logger.error('更新Credit状态失败', { txHash, status, error });
      throw error;
    }
  }

  /**
   * 查找Credit记录（通过交易哈希）
   */
  async findCreditsByTxHash(txHash: string): Promise<Credit[]> {
    try {
      const rows = await database.all(
        'SELECT * FROM credits WHERE tx_hash = ? ORDER BY created_at ASC',
        [txHash]
      );
      return rows as Credit[];
    } catch (error) {
      logger.error('查找Credit记录失败', { txHash, error });
      throw error;
    }
  }

  /**
   * 删除指定区块范围的Credit记录（用于重组回滚）
   */
  async deleteByBlockRange(startBlock: number, endBlock: number): Promise<number> {
    try {
      const result = await database.run(
        'DELETE FROM credits WHERE block_number >= ? AND block_number <= ?',
        [startBlock, endBlock]
      );
      
      const deletedCount = result.changes || 0;
      logger.info('重组回滚删除Credit记录', {
        startBlock,
        endBlock,
        deletedCount
      });
      
      return deletedCount;
    } catch (error) {
      logger.error('删除Credit记录失败', { startBlock, endBlock, error });
      throw error;
    }
  }

  /**
   * 获取用户余额（实时计算）
   */
  async getUserBalance(userId: number, tokenId: number): Promise<{
    available_balance: string;
    frozen_balance: string;
    total_balance: string;
  } | null> {
    try {
      const result = await database.get(
        `SELECT 
          SUM(CASE 
            WHEN credit_type NOT IN ('freeze') AND status = 'finalized' 
            THEN CAST(amount AS REAL) 
            ELSE 0 
          END) as available_balance,
          SUM(CASE 
            WHEN credit_type = 'freeze' AND status = 'finalized' 
            THEN CAST(amount AS REAL) 
            ELSE 0 
          END) as frozen_balance,
          SUM(CASE 
            WHEN status = 'finalized' 
            THEN CAST(amount AS REAL) 
            ELSE 0 
          END) as total_balance
        FROM credits 
        WHERE user_id = ? AND token_id = ?`,
        [userId, tokenId]
      );

      if (!result || result.total_balance === 0) {
        return null;
      }

      return {
        available_balance: result.available_balance.toString(),
        frozen_balance: result.frozen_balance.toString(),
        total_balance: result.total_balance.toString()
      };
    } catch (error) {
      logger.error('获取用户余额失败', { userId, tokenId, error });
      throw error;
    }
  }

  /**
   * 获取Credit统计信息
   */
  async getStats(): Promise<{
    totalCredits: number;
    pendingCredits: number;
    confirmedCredits: number;
    finalizedCredits: number;
    failedCredits: number;
  }> {
    try {
      const result = await database.get(
        `SELECT 
          COUNT(*) as totalCredits,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingCredits,
          SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmedCredits,
          SUM(CASE WHEN status = 'finalized' THEN 1 ELSE 0 END) as finalizedCredits,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCredits
        FROM credits`
      );

      return result || {
        totalCredits: 0,
        pendingCredits: 0,
        confirmedCredits: 0,
        finalizedCredits: 0,
        failedCredits: 0
      };
    } catch (error) {
      logger.error('获取Credit统计失败', { error });
      throw error;
    }
  }
}

// 导出DAO实例
export const creditDAO = new CreditDAO();
