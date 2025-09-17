import { viemClient } from '../utils/viemClient';
import { transactionDAO, walletDAO, tokenDAO, balanceDAO, database } from '../db/models';
import logger from '../utils/logger';
import config from '../config';
import { Transaction, Block } from 'viem';

export interface DepositTransaction {
  txHash: string;
  blockHash: string;
  blockNumber: number;
  fromAddress: string;
  toAddress: string;
  amount: bigint;
  tokenAddress?: string;
  tokenSymbol: string;
  userId: number;
}

export class TransactionAnalyzer {
  private userAddresses: Set<string> = new Set();
  private supportedTokens: Map<string, any> = new Map();
  private lastAddressUpdate: number = 0;
  private lastTokenUpdate: number = 0;
  private readonly CACHE_DURATION = 15 * 60 * 1000; // 15分钟缓存（有数据变化检测兜底）
  
  // 检测用户数据 或 Token 变化
  private lastUserCount = 0;
  private lastTokenCount = 0;
  private readonly UPDATE_CHECK_INTERVAL = 30 * 1000; // 30秒检查一次
  private lastUpdateCheck = 0;

  constructor() {
    this.loadUserAddresses();
    this.loadSupportedTokens();
  }

  /**
   * 分析区块中的交易
   */
  async analyzeBlock(blockNumber: number): Promise<DepositTransaction[]> {
    try {
      logger.debug('开始分析区块交易', { blockNumber });

      const block = await viemClient.getBlock(blockNumber);
      if (!block) {
        logger.warn('区块不存在', { blockNumber });
        return [];
      }

      const deposits: DepositTransaction[] = [];

      // 确保地址和代币信息是最新的
      await this.refreshCacheIfNeeded();

      // 分析区块中的每笔交易
      for (const txData of block.transactions) {
        try {
          if (typeof txData === 'string') {
            // 如果是交易哈希，需要获取交易详情
            const tx = await viemClient.getTransaction(txData);
            if (tx) {
              const deposit = await this.analyzeTransaction(tx, block.hash!, blockNumber);
              if (deposit) {
                deposits.push(deposit);
              }
            }
          } else {
            // 如果已经是交易对象
            const deposit = await this.analyzeTransaction(txData, block.hash!, blockNumber);
            if (deposit) {
              deposits.push(deposit);
            }
          }
        } catch (error) {
          logger.warn('分析单个交易失败', { 
            blockNumber, 
            txHash: typeof txData === 'string' ? txData : txData.hash,
            error 
          });
        }
      }

      logger.debug('区块交易分析完成', {
        blockNumber,
        totalTransactions: block.transactions.length,
        deposits: deposits.length
      });

      return deposits;

    } catch (error) {
      logger.error('分析区块交易失败', { blockNumber, error });
      throw error;
    }
  }

  /**
   * 分析单个交易
   */
  private async analyzeTransaction(
    tx: Transaction,
    blockHash: string,
    blockNumber: number
  ): Promise<DepositTransaction | null> {
    try {
      // 检查是否是ETH转账到用户地址
      if (tx.to && this.isUserAddress(tx.to) && tx.value > 0n) {
        const wallet = await walletDAO.getWalletByAddress(tx.to);
        const ethToken = this.supportedTokens.get('native');
        
        if (wallet && ethToken) {
          logger.info('检测到ETH存款', {
            txHash: tx.hash,
            to: tx.to,
            amount: viemClient.formatEther(tx.value),
            userId: wallet.user_id
          });

          return {
            txHash: tx.hash,
            blockHash,
            blockNumber,
            fromAddress: tx.from || '',
            toAddress: tx.to,
            amount: tx.value,
            tokenSymbol: ethToken.token_symbol,
            userId: wallet.user_id
          };
        }
      }

      // 检查是否是Token转账
      if (tx.to && this.supportedTokens.has(tx.to.toLowerCase())) {
        const tokenDeposit = await this.analyzeTokenTransfer(tx, blockHash, blockNumber);
        if (tokenDeposit) {
          return tokenDeposit;
        }
      }

      return null;

    } catch (error) {
      logger.warn('分析单个交易失败', { txHash: tx.hash, error });
      return null;
    }
  }

  /**
   * 分析Token转账
   */
  private async analyzeTokenTransfer(
    tx: Transaction,
    blockHash: string,
    blockNumber: number
  ): Promise<DepositTransaction | null> {
    try {
      // 获取交易收据以获取事件日志
      const receipt = await viemClient.getTransactionReceipt(tx.hash);
      if (!receipt) {
        return null;
      }

      const tokenInfo = this.supportedTokens.get(tx.to!.toLowerCase());
      if (!tokenInfo) {
        return null;
      }

      // 分析每个日志事件
      for (const log of receipt.logs) {
        // 检查是否是Transfer事件
        if (log.address.toLowerCase() === tx.to!.toLowerCase()) {
          const transferEvent = viemClient.parseERC20Transfer(log);
          if (transferEvent && transferEvent.to && this.isUserAddress(transferEvent.to)) {
            const wallet = await walletDAO.getWalletByAddress(transferEvent.to);
            // 获取代币信息
            const tokenInfo = this.getTokenInfo(tx.to!);
            
            if (wallet && tokenInfo) {
              logger.info('检测到Token存款', {
                txHash: tx.hash,
                tokenAddress: tx.to,
                tokenSymbol: tokenInfo.token_symbol,
                to: transferEvent.to,
                amount: transferEvent.value.toString(),
                userId: wallet.user_id
              });

              return {
                txHash: tx.hash,
                blockHash,
                blockNumber,
                fromAddress: transferEvent.from,
                toAddress: transferEvent.to,
                amount: transferEvent.value,
                tokenAddress: tx.to || undefined,
                tokenSymbol: tokenInfo.token_symbol,
                userId: wallet.user_id
              };
            }
          }
        }
      }

      return null;

    } catch (error) {
      logger.warn('分析Token转账失败', { txHash: tx.hash, error });
      return null;
    }
  }

  /**
   * 处理检测到的存款
   */
  async processDeposit(deposit: DepositTransaction): Promise<void> {
    try {
      // 获取代币信息以确定精度
      let tokenInfo = null;
      if (deposit.tokenAddress) {
        tokenInfo = this.supportedTokens.get(deposit.tokenAddress.toLowerCase());
      } else {
        tokenInfo = this.supportedTokens.get('native');
      }
      
      const decimals = tokenInfo?.decimals || 18;
      
      // 保存交易记录
      await transactionDAO.insertTransaction({
        block_hash: deposit.blockHash,
        block_no: deposit.blockNumber,
        tx_hash: deposit.txHash,
        from_addr: deposit.fromAddress,
        to_addr: deposit.toAddress,
        token_addr: deposit.tokenAddress,
        amount: parseFloat(viemClient.formatUnits(deposit.amount, decimals)),
        fee: 0, // 这里是存款，没有手续费
        type: 'deposit',
        status: 'confirmed',
        confirmation_count: 0
      });

      // 等交易 finalized 后直接更新 balance

      logger.info('存款处理完成', {
        txHash: deposit.txHash,
        userId: deposit.userId,
        tokenSymbol: deposit.tokenSymbol,
        amount: viemClient.formatUnits(deposit.amount, decimals),
        decimals
      });

    } catch (error) {
      logger.error('处理存款失败', { deposit, error });
      throw error;
    }
  }

  /**
   * 检查是否是用户地址
   */
  private isUserAddress(address: string): boolean {
    return this.userAddresses.has(address.toLowerCase());
  }

  /**
   * 加载用户地址列表
   */
  private async loadUserAddresses(): Promise<void> {
    try {
      const addresses = await walletDAO.getAllWalletAddresses();
      this.userAddresses.clear();
      addresses.forEach(addr => this.userAddresses.add(addr.toLowerCase()));
      this.lastAddressUpdate = Date.now();
      
      logger.info('用户地址列表加载完成', { count: addresses.length });
    } catch (error) {
      logger.error('加载用户地址列表失败', { error });
    }
  }

  /**
   * 加载支持的代币列表（仅当前链）
   */
  private async loadSupportedTokens(): Promise<void> {
    try {
      // 获取当前链ID
      const chainId = await viemClient.getChainId();
      
      // 只获取当前链的代币
      const tokens = await tokenDAO.getTokensByChain(chainId);
      this.supportedTokens.clear();
      
      tokens.forEach(token => {
        // 处理原生代币（如ETH）- token_address 为 null
        if (!token.token_address && token.is_native) {
          this.supportedTokens.set('native', token);
        } 
        // 处理ERC20代币
        else if (token.token_address) {
          this.supportedTokens.set(token.token_address.toLowerCase(), token);
        }
      });
      this.lastTokenUpdate = Date.now();
      
      logger.info('支持的代币列表加载完成', { 
        chainId,
        count: tokens.length,
        nativeTokens: tokens.filter(t => t.is_native).length,
        erc20Tokens: tokens.filter(t => !t.is_native && t.token_address).length
      });
    } catch (error) {
      logger.error('加载支持的代币列表失败', { error });
    }
  }

  /**
   * 如果需要，刷新缓存（包括数据变化检测）
   */
  private async refreshCacheIfNeeded(): Promise<void> {
    const now = Date.now();
    
    // 检查数据变化（更频繁）
    if (now - this.lastUpdateCheck > this.UPDATE_CHECK_INTERVAL) {
      await this.checkForDataUpdates();
      this.lastUpdateCheck = now;
    }
    
    // 定期刷新缓存
    if (now - this.lastAddressUpdate > this.CACHE_DURATION) {
      await this.loadUserAddresses();
    }
    
    if (now - this.lastTokenUpdate > this.CACHE_DURATION) {
      await this.loadSupportedTokens();
    }
  }

  /**
   * 检查数据是否有更新（轻量级检查）
   */
  private async checkForDataUpdates(): Promise<void> {
    try {
      const chainId = await viemClient.getChainId();
      
      // 检查用户数量变化
      const userCount = await database.get('SELECT COUNT(*) as count FROM wallets');
      const tokenCount = await database.get('SELECT COUNT(*) as count FROM tokens WHERE chain_id = ?', [chainId]);

      let needRefresh = false;
      
      if (userCount.count !== this.lastUserCount) {
        logger.info('检测到用户数量变化，将刷新地址缓存', {
          oldCount: this.lastUserCount,
          newCount: userCount.count
        });
        this.lastUserCount = userCount.count;
        needRefresh = true;
      }

      if (tokenCount.count !== this.lastTokenCount) {
        logger.info('检测到代币数量变化，将刷新代币缓存', {
          oldCount: this.lastTokenCount,
          newCount: tokenCount.count,
          chainId
        });
        this.lastTokenCount = tokenCount.count;
        needRefresh = true;
      }

      if (needRefresh) {
        await this.refreshCache();
      }

    } catch (error) {
      logger.error('检查数据更新失败', { error });
    }
  }

  /**
   * 手动刷新缓存
   */
  async refreshCache(): Promise<void> {
    await this.loadUserAddresses();
    await this.loadSupportedTokens();
    logger.info('缓存刷新完成');
  }

  /**
   * 获取代币信息
   */
  private getTokenInfo(tokenAddress: string): any {
    return this.supportedTokens.get(tokenAddress.toLowerCase()) || null;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    userAddressCount: number;
    supportedTokenCount: number;
    lastAddressUpdate: number;
    lastTokenUpdate: number;
  } {
    return {
      userAddressCount: this.userAddresses.size,
      supportedTokenCount: this.supportedTokens.size,
      lastAddressUpdate: this.lastAddressUpdate,
      lastTokenUpdate: this.lastTokenUpdate
    };
  }

  /**
   * 分析历史区块（用于补扫）
   */
  async analyzeHistoricalBlocks(startBlock: number, endBlock: number): Promise<void> {
    try {
      logger.info('开始分析历史区块', { startBlock, endBlock });

      for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
        const deposits = await this.analyzeBlock(blockNumber);
        
        for (const deposit of deposits) {
          await this.processDeposit(deposit);
        }

        if (blockNumber % 100 === 0) {
          logger.info('历史区块分析进度', { 
            current: blockNumber, 
            total: endBlock,
            progress: ((blockNumber - startBlock) / (endBlock - startBlock) * 100).toFixed(2) + '%'
          });
        }
      }

      logger.info('历史区块分析完成', { startBlock, endBlock });

    } catch (error) {
      logger.error('分析历史区块失败', { startBlock, endBlock, error });
      throw error;
    }
  }
}

export const transactionAnalyzer = new TransactionAnalyzer();
