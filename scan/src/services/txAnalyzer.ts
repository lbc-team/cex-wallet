import { viemClient } from '../utils/viemClient';
import { transactionDAO, walletDAO, tokenDAO, database } from '../db/models';
import { creditDAO } from '../db/creditDAO';
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
  logIndex?: number; // 事件在区块中的索引
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
   * 优化版区块分析：使用 bloom 过滤器预筛选相关交易
   * 通过 getLogs 和地址过滤，只获取与用户地址相关的转账事件，避免逐笔分析所有交易
   */
  async analyzeBlock(blockNumber: number): Promise<DepositTransaction[]> {
    try {
      logger.debug('开始 bloom 过滤器优化分析区块交易', { blockNumber });

      // 确保地址和代币信息是最新的
      await this.refreshCacheIfNeeded();

      if (this.userAddresses.size === 0) {
        logger.debug('无用户地址，跳过区块分析', { blockNumber });
        return [];
      }

      const deposits: DepositTransaction[] = [];
      const userAddressList = Array.from(this.userAddresses);
      const tokenAddressList = Array.from(this.supportedTokens.keys()).filter(key => key !== 'native');

      // 使用 bloom 过滤器原理：通过 getLogs 预筛选相关的转账事件，减少需要处理的交易数量
      const transferData = await viemClient.getUserTransfersInBlocks(
        blockNumber,
        blockNumber,
        userAddressList,
        tokenAddressList
      );

      // 处理ERC20转账
      for (const log of transferData.erc20Logs) {
        try {
          const deposit = await this.processERC20TransferLog(log, blockNumber);
          if (deposit) {
            deposits.push(deposit);
          }
        } catch (error) {
          logger.warn('处理ERC20转账日志失败', { 
            blockNumber,
            logAddress: log.address,
            error 
          });
        }
      }

      // 处理ETH转账
      for (const ethTx of transferData.ethTransactions) {
        try {
          const deposit = await this.processEthTransfer(ethTx, blockNumber);
          if (deposit) {
            deposits.push(deposit);
          }
        } catch (error) {
          logger.warn('处理ETH转账失败', { 
            blockNumber,
            txHash: ethTx.hash,
            error 
          });
        }
      }

      logger.info('优化区块交易分析完成', {
        blockNumber,
        erc20Logs: transferData.erc20Logs.length,
        ethTransactions: transferData.ethTransactions.length,
        totalDeposits: deposits.length
      });

      return deposits;

    } catch (error) {
      logger.error('优化分析区块交易失败', { blockNumber, error });
      throw error;
    }
  }

  /**
   * 批量分析多个区块查找存款交易：使用 bloom 过滤器优化批量处理
   * 一次性获取多个区块的相关转账事件，专门检测用户存款
   */
  async analyzeBatchBlocksForDeposits(fromBlock: number, toBlock: number): Promise<DepositTransaction[]> {
    try {
      logger.info('开始批量 bloom 过滤器优化分析区块', { fromBlock, toBlock });

      // 确保地址和代币信息是最新的
      await this.refreshCacheIfNeeded();

      if (this.userAddresses.size === 0) {
        logger.debug('无用户地址，跳过批量分析', { fromBlock, toBlock });
        return [];
      }

      const deposits: DepositTransaction[] = [];
      const userAddressList = Array.from(this.userAddresses);
      const tokenAddressList = Array.from(this.supportedTokens.keys()).filter(key => key !== 'native');

      // 批量获取多个区块的相关转账（使用 bloom 过滤器预筛选）
      const transferData = await viemClient.getUserTransfersInBlocks(
        fromBlock,
        toBlock,
        userAddressList,
        tokenAddressList
      );

      // 处理ERC20转账日志
      for (const log of transferData.erc20Logs) {
        try {
          const deposit = await this.processERC20TransferLog(log);
          if (deposit) {
            deposits.push(deposit);
          }
        } catch (error) {
          logger.warn('批量处理ERC20转账日志失败', { 
            logAddress: log.address,
            blockNumber: log.blockNumber,
            error 
          });
        }
      }

      // 处理ETH转账
      for (const ethTx of transferData.ethTransactions) {
        try {
          const deposit = await this.processEthTransfer(ethTx);
          if (deposit) {
            deposits.push(deposit);
          }
        } catch (error) {
          logger.warn('批量处理ETH转账失败', { 
            txHash: ethTx.hash,
            blockNumber: ethTx.blockNumber,
            error 
          });
        }
      }

      logger.info('批量优化区块分析完成', {
        fromBlock,
        toBlock,
        blockCount: toBlock - fromBlock + 1,
        erc20Logs: transferData.erc20Logs.length,
        ethTransactions: transferData.ethTransactions.length,
        totalDeposits: deposits.length
      });

      return deposits;

    } catch (error) {
      logger.error('批量优化分析区块失败', { fromBlock, toBlock, error });
      throw error;
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
        amount: deposit.amount.toString(),
        type: 'deposit',
        status: 'confirmed',
        confirmation_count: 0
      });

      // 立即创建Credit记录（使用真实的事件索引）
      await creditDAO.createDepositCredit({
        userId: deposit.userId,
        address: deposit.toAddress,
        tokenId: tokenInfo.id,
        tokenSymbol: deposit.tokenSymbol,
        amount: deposit.amount.toString(),
        txHash: deposit.txHash,
        blockNumber: deposit.blockNumber,
        chainId: tokenInfo.chainId,
        chainType: tokenInfo.chainType,
        eventIndex: deposit.logIndex, // 使用真实的事件索引
        status: 'confirmed', // 初始状态为confirmed
        metadata: {
          fromAddress: deposit.fromAddress,
          tokenAddress: deposit.tokenAddress,
          decimals: decimals,
          logIndex: deposit.logIndex
        }
      });

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
        // 处理原生代币（如ETH）- token_address 为 null 或全零地址
        if ((!token.token_address || token.token_address === '0x0000000000000000000000000000000000000000') && token.is_native) {
          this.supportedTokens.set('native', token);
        } 
        // 处理ERC20代币
        else if (token.token_address && token.token_address !== '0x0000000000000000000000000000000000000000') {
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
   * 处理ERC20转账日志
   */
  private async processERC20TransferLog(log: any, blockNumber?: number): Promise<DepositTransaction | null> {
    try {
      // 解析Transfer事件
      const transferEvent = viemClient.parseERC20Transfer(log);
      if (!transferEvent) {
        return null;
      }

      // 检查接收地址是否是用户地址
      if (!this.isUserAddress(transferEvent.to)) {
        return null;
      }

      // 获取用户钱包信息
      const wallet = await walletDAO.getWalletByAddress(transferEvent.to);
      if (!wallet) {
        return null;
      }

      // 获取代币信息
      const tokenInfo = this.getTokenInfo(log.address);
      if (!tokenInfo) {
        logger.warn('未找到代币信息', { tokenAddress: log.address });
        return null;
      }

      // 获取区块信息
      let blockHash = log.blockHash;
      let actualBlockNumber = blockNumber || Number(log.blockNumber); // 优先使用传入的blockNumber，回退到log.blockNumber
      
      if (!actualBlockNumber) {
        logger.error('区块号不能为空', { txHash: log.transactionHash });
        return null;
      }
      
      if (!blockHash) {
        const block = await viemClient.getBlock(actualBlockNumber);
        blockHash = block?.hash || '';
      }

      logger.info('检测到ERC20存款（优化版）', {
        txHash: log.transactionHash,
        tokenAddress: log.address,
        tokenSymbol: tokenInfo.token_symbol,
        to: transferEvent.to,
        amount: transferEvent.value.toString(),
        userId: wallet.user_id,
        blockNumber: actualBlockNumber
      });

      return {
        txHash: log.transactionHash,
        blockHash,
        blockNumber: actualBlockNumber,
        fromAddress: transferEvent.from,
        toAddress: transferEvent.to,
        amount: transferEvent.value,
        tokenAddress: log.address,
        tokenSymbol: tokenInfo.token_symbol,
        userId: wallet.user_id,
        logIndex: Number(log.logIndex) // 添加真实的事件索引
      };

    } catch (error) {
      logger.warn('处理ERC20转账日志失败', { 
        logAddress: log.address,
        txHash: log.transactionHash,
        error 
      });
      return null;
    }
  }

  /**
   * 处理ETH转账
   */
  private async processEthTransfer(tx: any, blockNumber?: number): Promise<DepositTransaction | null> {
    try {
      // 检查接收地址是否是用户地址
      if (!tx.to || !this.isUserAddress(tx.to) || tx.value <= 0n) {
        return null;
      }

      // 获取用户钱包信息
      const wallet = await walletDAO.getWalletByAddress(tx.to);
      if (!wallet) {
        return null;
      }

      // 获取ETH代币信息
      const ethToken = this.supportedTokens.get('native');
      if (!ethToken) {
        logger.warn('未找到ETH代币信息');
        return null;
      }

      // 获取区块信息
      let blockHash = tx.blockHash;
      let actualBlockNumber = blockNumber || Number(tx.blockNumber); // 优先使用传入的blockNumber，回退到tx.blockNumber
      
      if (!actualBlockNumber) {
        logger.error('区块号不能为空', { txHash: tx.hash });
        return null;
      }
      
      if (!blockHash) {
        const block = await viemClient.getBlock(actualBlockNumber);
        blockHash = block?.hash || '';
      }

      logger.info('检测到ETH存款（优化版）', {
        txHash: tx.hash,
        to: tx.to,
        amount: viemClient.formatEther(tx.value),
        userId: wallet.user_id,
        blockNumber: actualBlockNumber?.toString()
      });

      return {
        txHash: tx.hash,
        blockHash,
        blockNumber: actualBlockNumber,
        fromAddress: tx.from || '',
        toAddress: tx.to,
        amount: tx.value,
        tokenSymbol: ethToken.token_symbol,
        userId: wallet.user_id,
        logIndex: Number(tx.transactionIndex) || 0 // ETH转账使用交易索引作为事件索引
      };

    } catch (error) {
      logger.warn('处理ETH转账失败', { 
        txHash: tx.hash,
        error 
      });
      return null;
    }
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
   * 分析历史区块（用于补扫）- 使用批量处理
   */
  async analyzeHistoricalBlocks(startBlock: number, endBlock: number): Promise<void> {
    try {
      logger.info('开始分析历史区块（使用批量优化和事务）', { startBlock, endBlock });

      const batchSize = 10; // 每批处理10个区块
      for (let batchStart = startBlock; batchStart <= endBlock; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize - 1, endBlock);
        
        // 分析区块（在事务外进行，避免长时间锁定）
        const deposits = await this.analyzeBatchBlocksForDeposits(batchStart, batchEnd);
        
        // 使用事务批量处理存款
        if (deposits.length > 0) {
          await database.transaction(async () => {
            // 批量处理检测到的存款
            for (const deposit of deposits) {
              await this.processDeposit(deposit);
            }
            
            logger.debug('历史区块批次事务提交成功', { 
              batchStart,
              batchEnd,
              deposits: deposits.length
            });
          });
        }

        logger.info('历史区块分析进度', { 
          batchStart,
          batchEnd,
          deposits: deposits.length,
          progress: ((batchEnd - startBlock) / (endBlock - startBlock) * 100).toFixed(2) + '%'
        });
      }

      logger.info('历史区块分析完成', { startBlock, endBlock });

    } catch (error) {
      logger.error('分析历史区块失败', { startBlock, endBlock, error });
      throw error;
    }
  }
}

export const transactionAnalyzer = new TransactionAnalyzer();
