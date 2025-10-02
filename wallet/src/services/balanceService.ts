import { DatabaseReader } from '../db/index';
import {
  CreditModel,
  CreateCreditRequest,
  CreditType,
  BusinessType,
  UserBalance,
  Credit
} from '../db/models/credit';
import { normalizeBigIntString } from '../utils/numberUtils';
import { getDbGatewayClient } from './dbGatewayClient';

/**
 * 余额服务 - 基于Credits流水表的余额管理
 */
export class BalanceService {
  private dbService: DatabaseReader;
  private creditModel: CreditModel;

  constructor(dbService: DatabaseReader) {
    this.dbService = dbService;
    this.creditModel = dbService.credits;
  }


  /**
   * 获取用户余额（按地址分组，详细模式）
   */
  async getUserBalances(userId: number, tokenId?: number): Promise<UserBalance[]> {
    return await this.creditModel.getUserBalances(userId, tokenId);
  }

  /**
   * 获取用户余额（跨地址聚合，优化性能）
   * 使用视图优化，适合资产概览场景
   */
  async getUserBalancesOptimized(userId: number, tokenId?: number): Promise<UserBalance[]> {
    const aggregatedBalances = await this.creditModel.getUserAggregatedBalances(userId, tokenId);

    // 转换为UserBalance格式
    return aggregatedBalances.map(balance => ({
      user_id: userId,
      address: '', // 聚合模式下不包含具体地址信息
      token_id: balance.token_id,
      token_symbol: balance.token_symbol,
      decimals: balance.decimals,
      available_balance: balance.available_balance,
      frozen_balance: balance.frozen_balance,
      total_balance: balance.total_balance,
      available_balance_formatted: balance.available_balance_formatted,
      frozen_balance_formatted: balance.frozen_balance_formatted,
      total_balance_formatted: balance.total_balance_formatted
    }));
  }

  /**
   * 获取用户各代币总余额（使用视图优化）
   */
  async getUserTotalBalancesByToken(userId: number): Promise<{
    token_symbol: string;
    total_balance: string;
    available_balance: string;
    frozen_balance: string;
    address_count: number;
  }[]> {
    return await this.creditModel.getUserTotalBalancesByToken(userId);
  }


  /**
   * 获取用户余额变更历史
   */
  async getUserBalanceHistory(userId: number, options?: {
    tokenId?: number;
    creditType?: CreditType;
    businessType?: BusinessType;
    limit?: number;
    offset?: number;
  }): Promise<Credit[]> {
    const queryOptions: any = {
      order_by: 'created_at',
      order_direction: 'DESC'
    };
    
    if (options?.tokenId !== undefined) queryOptions.token_id = options.tokenId;
    if (options?.creditType !== undefined) queryOptions.credit_type = options.creditType;
    if (options?.businessType !== undefined) queryOptions.business_type = options.businessType;
    if (options?.limit !== undefined) queryOptions.limit = options.limit;
    if (options?.offset !== undefined) queryOptions.offset = options.offset;
    
    return await this.creditModel.findByUser(userId, queryOptions);
  }

  /**
   * 检查用户是否有足够余额
   */
  async checkSufficientBalance(
    userId: number,
    tokenId: number,
    requiredAmount: string,
    useOptimized: boolean = true
  ): Promise<{ sufficient: boolean; availableBalance: string }> {
    // 优先使用优化查询（跨地址聚合），性能更好
    const balances = useOptimized
      ? await this.getUserBalancesOptimized(userId, tokenId)
      : await this.getUserBalances(userId, tokenId);

    if (balances.length === 0) {
      return { sufficient: false, availableBalance: '0' };
    }

    const totalAvailable = balances.reduce((sum, balance) => {
      // 标准化数值，避免科学计数法
      const normalizedBalance = normalizeBigIntString(balance.available_balance);
      return sum + BigInt(normalizedBalance);
    }, BigInt(0));

    const required = BigInt(requiredAmount);

    return {
      sufficient: totalAvailable >= required,
      availableBalance: totalAvailable.toString()
    };
  }

  /**
   * 重组回滚：删除指定区块范围的Credits - 使用SQL构建方式
   */
  async rollbackByBlockRange(startBlock: number, endBlock: number): Promise<number> {
    const dbGatewayClient = getDbGatewayClient();
    return await dbGatewayClient.deleteByBlockRange(startBlock, endBlock);
  }

  /**
   * 获取Credit统计信息
   */
  async getStats(userId?: number): Promise<{
    totalCredits: number;
    pendingCredits: number;
    confirmedCredits: number;
    finalizedCredits: number;
    failedCredits: number;
  }> {
    return await this.creditModel.getStats(userId);
  }

  /**
   * 根据交易哈希查找Credits
   */
  async findCreditsByTxHash(txHash: string): Promise<Credit[]> {
    return await this.creditModel.findByUser(0, { // userId=0表示查询所有用户
      tx_hash: txHash,
      limit: 100
    });
  }

  /**
   * 验证Credit记录的完整性
   */
  async validateCreditIntegrity(userId: number, tokenId: number): Promise<{
    valid: boolean;
    issues: string[];
    totalCredits: string;
    calculatedBalance: string;
  }> {
    const credits = await this.creditModel.findByUser(userId, {
      token_id: tokenId,
      status: 'finalized',
      limit: 10000 // 限制查询数量
    });

    const issues: string[] = [];
    let totalAmount = BigInt(0);

    // 检查每个credit的完整性
    for (const credit of credits) {
      try {
        const normalizedAmount = normalizeBigIntString(credit.amount);
        const amount = BigInt(normalizedAmount);
        totalAmount += amount;

        // 检查冻结/解冻配对
        if (credit.credit_type === CreditType.FREEZE) {
          const unfreezeCredit = credits.find(c => 
            c.reference_id === credit.reference_id &&
            c.reference_type === credit.reference_type &&
            c.credit_type === CreditType.UNFREEZE
          );
          
          if (!unfreezeCredit && credit.status === 'finalized') {
            issues.push(`冻结记录 ${credit.id} 缺少对应的解冻记录`);
          }
        }
      } catch (error) {
        issues.push(`Credit ${credit.id} 的金额格式错误: ${credit.amount}`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      totalCredits: credits.length.toString(),
      calculatedBalance: totalAmount.toString()
    };
  }


  /**
   * 获取热钱包余额（从 Credits 表获取）
   */
  async getWalletBalance(address: string, tokenId: number): Promise<string> {
    try {
      // 从 Credits 表获取指定地址的余额
      const balances = await this.creditModel.getUserBalancesByAddress(address, tokenId);
      
      if (balances.length === 0) {
        return '0';
      }

      const tokenBalance = balances.find(b => b.token_id === tokenId);
      return tokenBalance ? normalizeBigIntString(tokenBalance.available_balance) : '0';
      
    } catch (error) {
      console.error('获取钱包余额失败:', error);
      return '0';
    }
  }
}
