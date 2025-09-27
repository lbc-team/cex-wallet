import { DatabaseService } from '../db/index';
import { 
  CreditModel, 
  CreateCreditRequest, 
  CreditType, 
  BusinessType,
  UserBalance,
  Credit
} from '../db/models/credit';
import { BalanceCacheService } from './balanceCacheService';
import { normalizeBigIntString } from '../utils/numberUtils';

/**
 * 余额服务 - 基于Credits流水表的余额管理
 */
export class BalanceService {
  private dbService: DatabaseService;
  private creditModel: CreditModel;
  private cacheService: BalanceCacheService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
    this.creditModel = dbService.credits;
    this.cacheService = new BalanceCacheService(dbService.getConnection());
  }

  /**
   * 创建充值Credit记录（链上充值）
   */
  async createDepositCredit(params: {
    userId: number;
    address: string;
    tokenId: number;
    tokenSymbol: string;
    amount: string; // 最小单位
    txHash: string;
    blockNumber: number;
    status?: 'pending' | 'confirmed' | 'finalized';
    metadata?: any;
  }): Promise<Credit> {
    const creditData: CreateCreditRequest = {
      user_id: params.userId,
      address: params.address,
      token_id: params.tokenId,
      token_symbol: params.tokenSymbol,
      amount: params.amount,
      credit_type: CreditType.DEPOSIT,
      business_type: BusinessType.BLOCKCHAIN,
      reference_id: params.txHash,
      reference_type: 'blockchain_tx',
      status: params.status || 'confirmed',
      block_number: params.blockNumber,
      tx_hash: params.txHash,
      event_index: 0,
      metadata: params.metadata ? JSON.stringify(params.metadata) : ''
    };

    return await this.creditModel.create(creditData);
  }

  /**
   * 创建提现Credit记录（链上提现）
   */
  async createWithdrawCredit(params: {
    userId: number;
    address: string;
    tokenId: number;
    tokenSymbol: string;
    amount: string; // 负数，表示扣减
    txHash: string;
    blockNumber: number;
    status?: 'pending' | 'confirmed' | 'finalized';
    metadata?: any;
  }): Promise<Credit> {
    const creditData: CreateCreditRequest = {
      user_id: params.userId,
      address: params.address,
      token_id: params.tokenId,
      token_symbol: params.tokenSymbol,
      amount: params.amount.startsWith('-') ? params.amount : `-${params.amount}`,
      credit_type: CreditType.WITHDRAW,
      business_type: BusinessType.BLOCKCHAIN,
      reference_id: params.txHash,
      reference_type: 'blockchain_tx',
      status: params.status || 'pending',
      block_number: params.blockNumber,
      tx_hash: params.txHash,
      event_index: 0,
      metadata: params.metadata ? JSON.stringify(params.metadata) : ''
    };

    return await this.creditModel.create(creditData);
  }

  /**
   * 创建内部转账Credit记录
   */
  async createTransferCredit(params: {
    fromUserId: number;
    toUserId: number;
    fromAddress: string;
    toAddress: string;
    tokenId: number;
    tokenSymbol: string;
    amount: string;
    transferId: string;
    metadata?: any;
  }): Promise<{ fromCredit: Credit; toCredit: Credit }> {
    const fromCreditData: CreateCreditRequest = {
      user_id: params.fromUserId,
      address: params.fromAddress,
      token_id: params.tokenId,
      token_symbol: params.tokenSymbol,
      amount: `-${params.amount}`,
      credit_type: CreditType.TRANSFER_OUT,
      business_type: BusinessType.INTERNAL_TRANSFER,
      reference_id: params.transferId,
      reference_type: 'internal_transfer',
      status: 'finalized',
      event_index: 0,
      metadata: params.metadata ? JSON.stringify(params.metadata) : ''
    };

    const toCreditData: CreateCreditRequest = {
      user_id: params.toUserId,
      address: params.toAddress,
      token_id: params.tokenId,
      token_symbol: params.tokenSymbol,
      amount: params.amount,
      credit_type: CreditType.TRANSFER_IN,
      business_type: BusinessType.INTERNAL_TRANSFER,
      reference_id: params.transferId,
      reference_type: 'internal_transfer',
      status: 'finalized',
      event_index: 1,
      metadata: params.metadata ? JSON.stringify(params.metadata) : ''
    };

    const fromCredit = await this.creditModel.create(fromCreditData);
    const toCredit = await this.creditModel.create(toCreditData);

    return { fromCredit, toCredit };
  }

  /**
   * 冻结用户余额
   */
  async freezeBalance(params: {
    userId: number;
    address: string;
    tokenId: number;
    tokenSymbol: string;
    amount: string;
    referenceId: string;
    referenceType: string;
    metadata?: any;
  }): Promise<Credit> {
    const creditData: CreateCreditRequest = {
      user_id: params.userId,
      address: params.address,
      token_id: params.tokenId,
      token_symbol: params.tokenSymbol,
      amount: `-${params.amount}`, // 负数，从可用余额扣减
      credit_type: CreditType.FREEZE,
      business_type: BusinessType.SPOT_TRADE,
      reference_id: params.referenceId,
      reference_type: params.referenceType,
      status: 'finalized',
      event_index: 0,
      metadata: params.metadata ? JSON.stringify(params.metadata) : ''
    };

    return await this.creditModel.create(creditData);
  }

  /**
   * 解冻用户余额
   */
  async unfreezeBalance(params: {
    userId: number;
    address: string;
    tokenId: number;
    tokenSymbol: string;
    amount: string;
    referenceId: string;
    referenceType: string;
    metadata?: any;
  }): Promise<Credit> {
    const creditData: CreateCreditRequest = {
      user_id: params.userId,
      address: params.address,
      token_id: params.tokenId,
      token_symbol: params.tokenSymbol,
      amount: params.amount, // 正数，回到可用余额
      credit_type: CreditType.UNFREEZE,
      business_type: BusinessType.SPOT_TRADE,
      reference_id: params.referenceId,
      reference_type: params.referenceType,
      status: 'finalized',
      event_index: 1,
      metadata: params.metadata ? JSON.stringify(params.metadata) : ''
    };

    return await this.creditModel.create(creditData);
  }

  /**
   * 管理员调整余额
   */
  async adminAdjustBalance(params: {
    userId: number;
    address: string;
    tokenId: number;
    tokenSymbol: string;
    amount: string; // 可正可负
    adjustId: string;
    reason: string;
    operatorId: number;
  }): Promise<Credit> {
    const creditData: CreateCreditRequest = {
      user_id: params.userId,
      address: params.address,
      token_id: params.tokenId,
      token_symbol: params.tokenSymbol,
      amount: params.amount,
      credit_type: params.amount.startsWith('-') ? CreditType.PENALTY : CreditType.REWARD,
      business_type: BusinessType.ADMIN_ADJUST,
      reference_id: params.adjustId,
      reference_type: 'admin_adjust',
      status: 'finalized',
      event_index: 0,
      metadata: JSON.stringify({
        reason: params.reason,
        operator_id: params.operatorId,
        timestamp: new Date().toISOString()
      })
    };

    return await this.creditModel.create(creditData);
  }

  /**
   * 更新Credit状态（用于确认流程）
   */
  async updateCreditStatus(
    creditId: number, 
    status: 'pending' | 'confirmed' | 'finalized' | 'failed'
  ): Promise<Credit> {
    return await this.creditModel.updateStatus(creditId, status);
  }

  /**
   * 批量更新Credit状态（通过交易哈希）
   */
  async updateCreditStatusByTxHash(
    txHash: string, 
    status: 'pending' | 'confirmed' | 'finalized' | 'failed'
  ): Promise<void> {
    return await this.creditModel.updateStatusByTxHash(txHash, status);
  }

  /**
   * 获取用户余额（支持缓存优化）
   */
  async getUserBalances(userId: number, tokenId?: number, useCache: boolean = true): Promise<UserBalance[]> {
    if (useCache) {
      // 尝试使用缓存服务
      try {
        const cachedBalances = await this.cacheService.getUserBalances(userId, tokenId);
        
        // 转换缓存结果为UserBalance格式
        return cachedBalances.map(cache => ({
          user_id: userId,
          address: '', // 缓存中不包含地址信息
          token_id: cache.token_id,
          token_symbol: cache.token_symbol,
          decimals: 18, // 简化处理
          available_balance: cache.available_balance,
          frozen_balance: cache.frozen_balance,
          total_balance: cache.total_balance,
          available_balance_formatted: cache.available_balance_formatted,
          frozen_balance_formatted: cache.frozen_balance_formatted,
          total_balance_formatted: cache.total_balance_formatted
        }));
      } catch (error) {
        console.warn('缓存查询失败，回退到实时计算', { userId, error });
      }
    }
    
    // 实时计算
    return await this.creditModel.getUserBalances(userId, tokenId);
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
   * 刷新用户缓存
   */
  async refreshUserCache(userId: number): Promise<void> {
    await this.cacheService.refreshUserCache(userId);
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
    return await this.cacheService.getCacheStats();
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
    requiredAmount: string
  ): Promise<{ sufficient: boolean; availableBalance: string }> {
    const balances = await this.getUserBalances(userId, tokenId);
    
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
   * 重组回滚：删除指定区块范围的Credits
   */
  async rollbackByBlockRange(startBlock: number, endBlock: number): Promise<number> {
    return await this.creditModel.deleteByBlockRange(startBlock, endBlock);
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
