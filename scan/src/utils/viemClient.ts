import { createPublicClient, http, parseAbiItem, decodeEventLog, Block, Transaction, TransactionReceipt, Log } from 'viem';
import { localhost } from 'viem/chains';
import config from '../config';
import logger from './logger';

export class ViemClient {
  private client: any;
  private backupClient?: any;
  private currentClient: any;

  constructor() {
    // 主要客户端
    this.client = createPublicClient({
      chain: localhost,
      transport: http(config.ethRpcUrl)
    });
    
    // 备份客户端
    if (config.ethRpcUrlBackup) {
      this.backupClient = createPublicClient({
        chain: localhost,
        transport: http(config.ethRpcUrlBackup)
      });
    }
    
    this.currentClient = this.client;
    logger.info('Viem 客户端初始化完成', {
      rpcUrl: config.ethRpcUrl,
      hasBackup: !!config.ethRpcUrlBackup
    });
  }

  /**
   * 获取最新区块号
   */
  async getLatestBlockNumber(): Promise<number> {
    try {
      const blockNumber = await this.currentClient.getBlockNumber();
      logger.debug('获取最新区块号', { blockNumber: Number(blockNumber) });
      return Number(blockNumber);
    } catch (error) {
      logger.error('获取最新区块号失败', { error });
      
      // 尝试使用备份客户端
      if (this.backupClient && this.currentClient !== this.backupClient) {
        logger.warn('尝试使用备份 RPC 客户端');
        this.currentClient = this.backupClient;
        return this.getLatestBlockNumber();
      }
      
      throw error;
    }
  }

  /**
   * 获取区块信息
   */
  async getBlock(blockNumber: number): Promise<Block | null> {
    try {
      const block = await this.currentClient.getBlock({
        blockNumber: BigInt(blockNumber),
        includeTransactions: true
      });
      
      logger.debug('获取区块信息', { 
        blockNumber, 
        hash: block?.hash,
        txCount: block?.transactions?.length 
      });
      
      return block;
    } catch (error) {
      logger.error('获取区块信息失败', { blockNumber, error });
      
      // 尝试使用备份客户端
      if (this.backupClient && this.currentClient !== this.backupClient) {
        logger.warn('尝试使用备份 RPC 客户端');
        this.currentClient = this.backupClient;
        return this.getBlock(blockNumber);
      }
      
      throw error;
    }
  }

  /**
   * 获取交易详情
   */
  async getTransaction(txHash: string): Promise<Transaction | null> {
    try {
      const tx = await this.currentClient.getTransaction({
        hash: txHash as `0x${string}`
      });
      logger.debug('获取交易详情', { txHash, found: !!tx });
      return tx;
    } catch (error) {
      logger.error('获取交易详情失败', { txHash, error });
      
      // 尝试使用备份客户端
      if (this.backupClient && this.currentClient !== this.backupClient) {
        logger.warn('尝试使用备份 RPC 客户端');
        this.currentClient = this.backupClient;
        return this.getTransaction(txHash);
      }
      
      throw error;
    }
  }

  /**
   * 获取交易收据
   */
  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
    try {
      const receipt = await this.currentClient.getTransactionReceipt({
        hash: txHash as `0x${string}`
      });
      logger.debug('获取交易收据', { 
        txHash, 
        found: !!receipt,
        status: receipt?.status 
      });
      return receipt;
    } catch (error) {
      logger.error('获取交易收据失败', { txHash, error });
      
      // 尝试使用备份客户端
      if (this.backupClient && this.currentClient !== this.backupClient) {
        logger.warn('尝试使用备份 RPC 客户端');
        this.currentClient = this.backupClient;
        return this.getTransactionReceipt(txHash);
      }
      
      throw error;
    }
  }

  /**
   * 批量获取区块
   */
  async getBlocksBatch(startBlock: number, endBlock: number): Promise<(Block | null)[]> {
    const promises: Promise<Block | null>[] = [];
    
    for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
      promises.push(this.getBlock(blockNumber));
      
      // 控制并发数量
      if (promises.length >= config.maxConcurrentRequests) {
        break;
      }
    }
    
    try {
      const blocks = await Promise.all(promises);
      logger.debug('批量获取区块完成', { 
        startBlock, 
        endBlock, 
        count: blocks.length 
      });
      return blocks;
    } catch (error) {
      logger.error('批量获取区块失败', { startBlock, endBlock, error });
      throw error;
    }
  }

  /**
   * 解析 ERC20 转账事件
   */
  parseERC20Transfer(log: Log): {
    from: string;
    to: string;
    value: bigint;
  } | null {
    try {
      // ERC20 Transfer 事件的 ABI
      const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
      
      const decoded = decodeEventLog({
        abi: [transferEvent],
        data: log.data,
        topics: log.topics
      });
      
      if (decoded.eventName === 'Transfer') {
        return {
          from: decoded.args.from as string,
          to: decoded.args.to as string,
          value: decoded.args.value as bigint
        };
      }
      
      return null;
    } catch (error) {
      logger.debug('解析 ERC20 转账事件失败', { 
        topics: log.topics,
        error 
      });
      return null;
    }
  }

  /**
   * 获取指定区块范围内涉及用户地址的ERC20转账日志
   */
  async getERC20TransfersToUsers(
    fromBlock: number | 'latest',
    toBlock: number | 'latest',
    tokenAddresses: string[],
    userAddresses: string[]
  ): Promise<Log[]> {
    try {
      if (tokenAddresses.length === 0 || userAddresses.length === 0) {
        return [];
      }

      // Transfer(address indexed from, address indexed to, uint256 value)
      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

      const logs = await this.currentClient.getLogs({
        fromBlock: typeof fromBlock === 'number' ? `0x${fromBlock.toString(16)}` : fromBlock,
        toBlock: typeof toBlock === 'number' ? `0x${toBlock.toString(16)}` : toBlock,
        address: tokenAddresses, // 过滤特定的Token合约
        topics: [
          transferTopic, // Transfer事件
          null, // from地址（不过滤）
          userAddresses.map(addr => `0x${addr.slice(2).padStart(64, '0')}`) // to地址（过滤用户地址）
        ]
      });

      logger.debug('获取ERC20转账日志', {
        fromBlock,
        toBlock,
        tokenCount: tokenAddresses.length,
        userCount: userAddresses.length,
        logCount: logs.length
      });

      return logs;
    } catch (error) {
      logger.error('获取ERC20转账日志失败', { 
        fromBlock, 
        toBlock, 
        tokenAddresses: tokenAddresses.length,
        userAddresses: userAddresses.length,
        error 
      });
      throw error;
    }
  }

  /**
   * 批量获取多个区块的用户相关转账
   */
  async getUserTransfersInBlocks(
    fromBlock: number,
    toBlock: number,
    userAddresses: string[],
    tokenAddresses: string[]
  ): Promise<{
    erc20Logs: Log[];
    ethTransactions: Transaction[];
  }> {
    try {
      const [erc20Logs] = await Promise.all([
        this.getERC20TransfersToUsers(fromBlock, toBlock, tokenAddresses, userAddresses),
        
      ]);

      // ETH转账需要特殊处理，因为getLogs无法直接过滤ETH转账
      // 对于ETH转账，我们需要获取这些区块并过滤
      const ethTransactions: Transaction[] = [];
      
      for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
        const block = await this.getBlock(blockNum);
        if (block?.transactions) {
          for (const txData of block.transactions) {
            if (typeof txData !== 'string') {
              // 检查是否是ETH转账到用户地址
              if (txData.to && 
                  userAddresses.some(addr => addr.toLowerCase() === txData.to!.toLowerCase()) && 
                  txData.value > 0n) {
                logger.info('发现ETH转账', {
                  blockNumber: txData.blockNumber?.toString(),
                  txHash: txData.hash,
                  from: txData.from,
                  to: txData.to,
                  value: txData.value.toString(),
                  valueETH: Number(txData.value) / 1e18
                });
                ethTransactions.push(txData);
              }
            }
          }
        }
      }

      return {
        erc20Logs,
        ethTransactions
      };

    } catch (error) {
      logger.error('批量获取用户转账失败', { fromBlock, toBlock, error });
      throw error;
    }
  }

  /**
   * 检查连接状态
   */
  async checkConnection(): Promise<boolean> {
    try {
      await this.currentClient.getChainId();
      return true;
    } catch (error) {
      logger.error('连接检查失败', { error });
      return false;
    }
  }

  /**
   * 重置为主要客户端
   */
  resetToMainClient(): void {
    this.currentClient = this.client;
    logger.info('重置为主要 RPC 客户端');
  }

  /**
   * 格式化 Wei 为 Ether
   */
  formatEther(wei: bigint): string {
    // 简单的 Wei 到 Ether 转换，1 Ether = 10^18 Wei
    const divisor = BigInt('1000000000000000000'); // 10^18
    const ether = wei / divisor;
    const remainder = wei % divisor;
    
    if (remainder === 0n) {
      return ether.toString();
    } else {
      // 保留小数点后的部分
      const decimal = remainder.toString().padStart(18, '0').replace(/0+$/, '');
      return decimal ? `${ether}.${decimal}` : ether.toString();
    }
  }

  /**
   * 格式化代币数量
   */
  formatUnits(value: bigint, decimals: number = 18): string {
    const divisor = BigInt(10 ** decimals);
    const units = value / divisor;
    const remainder = value % divisor;
    
    if (remainder === 0n) {
      return units.toString();
    } else {
      const decimal = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
      return decimal ? `${units}.${decimal}` : units.toString();
    }
  }

  /**
   * 获取链 ID
   */
  async getChainId(): Promise<number> {
    try {
      const chainId = await this.currentClient.getChainId();
      return chainId;
    } catch (error) {
      logger.error('获取链ID失败', { error });
      throw error;
    }
  }

  /**
   * 检查地址是否为合约
   */
  async isContract(address: string): Promise<boolean> {
    try {
      const code = await this.currentClient.getBytecode({
        address: address as `0x${string}`
      });
      return !!code && code !== '0x';
    } catch (error) {
      logger.error('检查合约地址失败', { address, error });
      return false;
    }
  }

  /**
   * 获取 safe 区块（网络认为相对安全的区块）
   */
  async getSafeBlock(): Promise<{ number: bigint; hash: string } | null> {
    try {
      const block = await this.currentClient.getBlock({ blockTag: 'safe' });
      return {
        number: block.number!,
        hash: block.hash!
      };
    } catch (error) {
      logger.debug('获取 safe 区块失败，可能网络不支持', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  /**
   * 获取 finalized 区块（网络认为已终结的区块）
   */
  async getFinalizedBlock(): Promise<{ number: bigint; hash: string } | null> {
    try {
      const block = await this.currentClient.getBlock({ blockTag: 'finalized' });
      return {
        number: block.number!,
        hash: block.hash!
      };
    } catch (error) {
      logger.debug('获取 finalized 区块失败，可能网络不支持', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  /**
   * 检查网络是否支持 safe/finalized tag
   */
  async supportsFinality(): Promise<{ safe: boolean; finalized: boolean }> {
    const safeSupported = (await this.getSafeBlock()) !== null;
    const finalizedSupported = (await this.getFinalizedBlock()) !== null;
    
    logger.info('网络终结性支持检测', {
      safe: safeSupported,
      finalized: finalizedSupported
    });
    
    return {
      safe: safeSupported,
      finalized: finalizedSupported
    };
  }
}

// 创建单例实例
export const viemClient = new ViemClient();
