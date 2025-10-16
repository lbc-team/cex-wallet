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
