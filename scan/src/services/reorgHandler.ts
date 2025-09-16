import { viemClient } from '../utils/viemClient';
import { blockDAO, transactionDAO, walletDAO, balanceDAO, database } from '../db/models';
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

      // 4. 重新同步正确链
      await this.resyncCorrectChain(commonAncestor + 1, currentBlock);

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
   * 回滚单个区块
   */
  private async rollbackBlock(blockNumber: number): Promise<{ hash: string; transactionCount: number } | null> {
    try {
      const dbBlock = await blockDAO.getBlockByNumber(blockNumber);
      if (!dbBlock) {
        return null;
      }

      logger.debug('回滚区块', { blockNumber, hash: dbBlock.hash });

      // 1. 获取该区块的所有交易
      const transactions = await database.all(
        'SELECT * FROM transactions WHERE block_hash = ?',
        [dbBlock.hash]
      );

      // 2. 回滚交易相关的余额
      for (const tx of transactions) {
        await this.rollbackTransaction(tx);
      }

      // 3. 删除交易记录
      await database.run(
        'DELETE FROM transactions WHERE block_hash = ?',
        [dbBlock.hash]
      );

      // 4. 标记区块为孤块
      await database.run(
        'UPDATE blocks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE hash = ?',
        ['orphaned', dbBlock.hash]
      );

      return {
        hash: dbBlock.hash,
        transactionCount: transactions.length
      };

    } catch (error) {
      logger.error('回滚区块失败', { blockNumber, error });
      throw error;
    }
  }

  /**
   * 回滚单笔交易
   */
  private async rollbackTransaction(tx: any): Promise<void> {
    try {
      if (tx.type === 'deposit') {
        const wallet = await walletDAO.getWalletByAddress(tx.to_addr);
        if (!wallet) {
          return;
        }

        // 只有已经 finalized 的交易才需要回滚余额
        // 通常不会出现 finalized 后，再回滚
        if (tx.status === 'finalized') {
          // 确定代币符号
          let tokenSymbol = 'ETH';
          if (tx.token_addr) {
            const token = await database.get(
              'SELECT tokens_name FROM tokens WHERE token_address = ?',
              [tx.token_addr]
            );
            tokenSymbol = token ? token.tokens_name : 'UNKNOWN';
          }

          const amount = BigInt(Math.abs(tx.amount * 1e18));

          // 获取当前余额
          const balance = await database.get(
            'SELECT * FROM balances WHERE user_id = ? AND address = ? AND token_symbol = ?',
            [wallet.user_id, tx.to_addr, tokenSymbol]
          );

          if (balance) {
            // 从 balance 中减去已经添加的金额
            const currentBalance = BigInt(balance.balance || '0');
            const newBalance = currentBalance - amount;
            
            await database.run(
              'UPDATE balances SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND address = ? AND token_symbol = ?',
              [newBalance.toString(), wallet.user_id, tx.to_addr, tokenSymbol]
            );

            logger.debug('回滚交易余额', {
              txHash: tx.tx_hash,
              address: tx.to_addr,
              tokenSymbol,
              amount: amount.toString(),
              status: tx.status
            });
          }
        } else {
          logger.debug('跳过回滚未finalized的交易', {
            txHash: tx.tx_hash,
            status: tx.status
          });
        }
      }
    } catch (error) {
      logger.error('回滚交易失败', { txHash: tx.tx_hash, error });
      throw error;
    }
  }

  /**
   * 4. 重新同步正确链
   */
  private async resyncCorrectChain(startBlock: number, endBlock: number): Promise<void> {
    try {
      logger.info('开始重新同步正确链', { startBlock, endBlock });

      // 清理孤立区块数据
      await this.cleanupOrphanedBlocks();

      // 这里应该调用扫描器重新扫描这些区块
      // 但由于这个方法是在扫描过程中调用的，我们只需要返回
      // 让调用者知道需要重新扫描哪些区块

      logger.info('正确链重新同步准备完成', {
        blocksToRescan: endBlock - startBlock + 1
      });

    } catch (error) {
      logger.error('重新同步正确链失败', { startBlock, endBlock, error });
      throw error;
    }
  }

  /**
   * 5. 数据库清理和恢复机制
   */
  private async cleanupOrphanedBlocks(): Promise<void> {
    try {
      logger.info('开始清理孤立区块数据');

      // 获取所有孤立区块
      const orphanedBlocks = await database.all(
        'SELECT hash FROM blocks WHERE status = "orphaned"'
      );

      // 删除孤立区块的相关数据
      for (const block of orphanedBlocks) {
        // 删除相关交易（如果还有的话）
        await database.run(
          'DELETE FROM transactions WHERE block_hash = ?',
          [block.hash]
        );
      }

      // 删除孤立区块记录
      const result = await database.run(
        'DELETE FROM blocks WHERE status = "orphaned"'
      );

      logger.info('孤立区块数据清理完成', {
        deletedBlocks: result.changes || 0
      });

    } catch (error) {
      logger.error('清理孤立区块数据失败', { error });
      throw error;
    }
  }

  /**
   * 获取重组统计信息
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
