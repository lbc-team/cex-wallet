import { viemClient } from '../utils/viemClient';
import { blockDAO,  walletDAO, database } from '../db/models';
import { getDbGatewayClient } from './dbGatewayClient';
import logger from '../utils/logger';
import config from '../config';

export interface ReorgInfo {
  detectedAt: number;
  commonAncestor: number;
  orphanedBlocks: string[];
  revertedTransactions: number;
  blocksToRescan: number;
}

export class ReorgHandler {
  private dbGatewayClient = getDbGatewayClient();

  /**
   * 检查区块链重组并处理
   */
  async checkAndHandleReorg(currentBlock: number, currentHash: string): Promise<ReorgInfo | null> {
    try {
      // 1. 区块哈希连续性验证
      const reorgDetected = await this.detectReorg(currentBlock, currentHash);
      
      if (!reorgDetected) {
        return null;
      }

      logger.warn('检测到区块链重组', {
        blockNumber: currentBlock,
        detectedHash: currentHash
      });

      // 2. 寻找共同祖先
      const commonAncestor = await this.findCommonAncestor(currentBlock);

      // 3. 回滚到共同祖先
      const reorgInfo = await this.rollbackToCommonAncestor(commonAncestor, currentBlock);

      logger.info('区块链重组处理完成', reorgInfo);
      return reorgInfo;

    } catch (error) {
      logger.error('处理区块重组失败', { currentBlock, error });
      throw error;
    }
  }

  /**
   * 1. 检测区块链重组（区块哈希连续性验证）
   */
  private async detectReorg(blockNumber: number, chainHash: string): Promise<boolean> {
    try {
      // 检查当前区块哈希
      const dbBlock = await blockDAO.getBlockByNumber(blockNumber);
      
      if (!dbBlock) {
        // 数据库中没有该区块，不是重组
        return false;
      }

      if (dbBlock.hash === chainHash) {
        // 哈希匹配，检查父区块连续性
        return await this.validateParentChain(blockNumber, chainHash);
      }

      // 哈希不匹配，确定是重组
      return true;

    } catch (error) {
      logger.error('检测重组失败', { blockNumber, error });
      throw error;
    }
  }

  /**
   * 验证父区块链的连续性
   */
  private async validateParentChain(blockNumber: number, blockHash: string): Promise<boolean> {
    try {
      // 检查前面几个区块的连续性
      const checkDepth = Math.min(config.reorgCheckDepth, blockNumber - 1);
      
      for (let i = 1; i <= checkDepth; i++) {
        const checkBlockNumber = blockNumber - i;
        
        // 从链上获取区块
        const chainBlock = await viemClient.getBlock(checkBlockNumber);
        if (!chainBlock) {
          continue;
        }

        // 从数据库获取区块
        const dbBlock = await blockDAO.getBlockByNumber(checkBlockNumber);
        if (!dbBlock) {
          continue;
        }

        // 检查哈希是否匹配
        if (dbBlock.hash !== chainBlock.hash) {
          logger.warn('检测到父区块哈希不匹配', {
            blockNumber: checkBlockNumber,
            dbHash: dbBlock.hash,
            chainHash: chainBlock.hash
          });
          return true; // 检测到重组
        }

        // 检查父子关系
        if (i === 1) {
          const currentChainBlock = await viemClient.getBlock(blockNumber);
          if (currentChainBlock && currentChainBlock.parentHash !== chainBlock.hash) {
            logger.warn('检测到父子区块哈希不连续', {
              blockNumber,
              parentHash: currentChainBlock.parentHash,
              expectedParentHash: chainBlock.hash
            });
            return true; // 检测到重组
          }
        }
      }

      return false; // 没有检测到重组
    } catch (error) {
      logger.error('验证父区块链失败', { blockNumber, error });
      throw error;
    }
  }

  /**
   * 2. 寻找共同祖先区块
   */
  private async findCommonAncestor(startBlock: number): Promise<number> {
    try {
      logger.info('开始寻找共同祖先区块', { startBlock });

      // 从当前区块向前搜索，直到找到数据库和链上哈希匹配的区块
      for (let blockNumber = startBlock; blockNumber > 0; blockNumber--) {
        const dbBlock = await blockDAO.getBlockByNumber(blockNumber);
        const chainBlock = await viemClient.getBlock(blockNumber);

        if (dbBlock && chainBlock && dbBlock.hash === chainBlock.hash) {
          logger.info('找到共同祖先区块', {
            blockNumber,
            hash: dbBlock.hash
          });
          return blockNumber;
        }
      }

      // 如果没找到，返回配置的起始区块
      logger.warn('未找到共同祖先，回滚到起始区块', { startBlock: config.startBlock });
      return config.startBlock - 1;

    } catch (error) {
      logger.error('寻找共同祖先失败', { startBlock, error });
      throw error;
    }
  }

  /**
   * 3. 回滚到共同祖先
   */
  private async rollbackToCommonAncestor(commonAncestor: number, currentBlock: number): Promise<ReorgInfo> {
    try {
      logger.info('开始回滚到共同祖先', {
        commonAncestor,
        currentBlock,
        blocksToRollback: currentBlock - commonAncestor
      });

      const orphanedBlocks: string[] = [];
      let revertedTransactions = 0;

      // 首先删除受影响区块的Credit记录
      const deletedCredits = await this.dbGatewayClient.deleteCreditsByBlockRange(
        commonAncestor + 1,
        currentBlock
      );
      
      logger.info('重组回滚Credit记录', {
        startBlock: commonAncestor + 1,
        endBlock: currentBlock,
        deletedCredits
      });

      // 回滚从共同祖先之后的所有区块
      for (let blockNumber = commonAncestor + 1; blockNumber <= currentBlock; blockNumber++) {
        const result = await this.rollbackBlock(blockNumber);
        if (result) {
          orphanedBlocks.push(result.hash);
          revertedTransactions += result.transactionCount;
        }
      }

      const reorgInfo: ReorgInfo = {
        detectedAt: currentBlock,
        commonAncestor,
        orphanedBlocks,
        revertedTransactions,
        blocksToRescan: currentBlock - commonAncestor
      };

      logger.info('回滚完成', reorgInfo);
      return reorgInfo;

    } catch (error) {
      logger.error('回滚到共同祖先失败', { commonAncestor, currentBlock, error });
      throw error;
    }
  }

  /**
   * 获取可回滚的交易（排除有frozen credit的交易）
   * 直接查询数据库以提高性能
   */
  private async getRollbackableTransactions(blockHash: string): Promise<any[]> {
    try {
      // 直接查询数据库，排除有frozen credit的交易
      const sql = `
        SELECT DISTINCT t.*
        FROM transactions t
        LEFT JOIN credits c ON t.tx_hash = c.tx_hash
        WHERE t.block_hash = ?
        AND (c.status IS NULL OR c.status != 'frozen')
      `;

      const transactions = await database.all(sql, [blockHash]);
      logger.debug('获取可回滚交易', { blockHash, count: transactions.length });
      return transactions;
    } catch (error) {
      logger.error('获取可回滚交易失败', { blockHash, error });
      return [];
    }
  }

  /**
   * 回滚单个区块
   */
  private async rollbackBlock(blockNumber: number): Promise<{ hash: string; transactionCount: number } | null> {
    try {
      const dbBlock = await blockDAO.getBlockByNumber(blockNumber);
      if (!dbBlock) {
        return null;
      }

      logger.debug('回滚区块', { blockNumber, hash: dbBlock.hash });

      // 1. 获取可回滚的交易（排除frozen的）- 直接查询数据库
      const rollbackableTransactions = await this.getRollbackableTransactions(dbBlock.hash);

      if (rollbackableTransactions.length === 0) {
        logger.info('该区块没有可回滚的交易', { blockNumber, blockHash: dbBlock.hash });
        // 即使没有可回滚的交易，仍然标记区块为孤块
        await this.dbGatewayClient.updateBlockStatus(dbBlock.hash, 'orphaned');
        return {
          hash: dbBlock.hash,
          transactionCount: 0
        };
      }

      // 2. 通过dbGatewayClient删除可回滚的交易
      let deletedCount = 0;
      for (const tx of rollbackableTransactions) {
        const result = await this.dbGatewayClient.deleteTransaction(tx.tx_hash);
        if (result) {
          deletedCount++;
        }
      }

      logger.info('回滚交易完成', {
        blockNumber,
        blockHash: dbBlock.hash,
        totalTransactions: rollbackableTransactions.length,
        deletedCount
      });

      // 3. 标记区块为孤块
      const updateResult = await this.dbGatewayClient.updateBlockStatus(dbBlock.hash, 'orphaned');
      if (!updateResult) {
        logger.error('更新区块状态为孤块失败', { blockNumber, blockHash: dbBlock.hash });
      }

      return {
        hash: dbBlock.hash,
        transactionCount: deletedCount
      };

    } catch (error) {
      logger.error('回滚区块失败', { blockNumber, error });
      throw error;
    }
  }


  /**
   * 获取重组统计信息， 用于Dashboard展示 或 Debug
   */
  async getReorgStats(): Promise<{
    totalReorgs: number;
    orphanedBlocks: number;
    revertedTransactions: number;
  }> {
    try {
      const stats = await database.all(`
        SELECT 
          COUNT(DISTINCT hash) as orphaned_blocks,
          (SELECT COUNT(*) FROM transactions WHERE status = 'reverted') as reverted_transactions
        FROM blocks 
        WHERE status = 'orphaned'
      `);

      return {
        totalReorgs: 0, // 这个需要单独的统计表来记录
        orphanedBlocks: stats[0]?.orphaned_blocks || 0,
        revertedTransactions: stats[0]?.reverted_transactions || 0
      };

    } catch (error) {
      logger.error('获取重组统计失败', { error });
      throw error;
    }
  }
}

export const reorgHandler = new ReorgHandler();
