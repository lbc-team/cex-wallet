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
