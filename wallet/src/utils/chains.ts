import { createPublicClient, http, parseUnits } from 'viem';
import { mainnet, sepolia, bsc, bscTestnet, localhost } from 'viem/chains';
import { createSolanaRpc, type Rpc } from '@solana/kit';

// 支持的链类型
export type SupportedChain = 'mainnet' | 'sepolia' | 'bsc' | 'bscTestnet' | 'localhost' | 'solana';

// 链配置接口
export interface ChainConfig {
  chain: any;
  rpcUrl: string;
  name: string;
  chainId: number;
  chainType: 'evm' | 'solana';  // 添加链类型标识
}

/**
 * 统一的链配置管理
 */
export class ChainConfigManager {
  private static instance: ChainConfigManager;
  private chainConfigs: Map<SupportedChain, ChainConfig> = new Map();
  private publicClients: Map<SupportedChain, any> = new Map();
  private solanaRpcClient: Rpc<any> | null = null;  // Solana RPC 客户端

  private constructor() {
    this.initializeChainConfigs();
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): ChainConfigManager {
    if (!ChainConfigManager.instance) {
      ChainConfigManager.instance = new ChainConfigManager();
    }
    return ChainConfigManager.instance;
  }

  /**
   * 初始化链配置
   */
  private initializeChainConfigs(): void {
    // 根据环境变量配置RPC URL
    const defaultRpcUrls = {
      mainnet: process.env.MAINNET_RPC_URL || process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
      sepolia: process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.public.blastapi.io',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
      bscTestnet: process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545/',
      localhost: process.env.LOCALHOST_RPC_URL || 'http://127.0.0.1:8545',
      solana: process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899'
    };

    // 以太坊主网
    this.chainConfigs.set('mainnet', {
      chain: mainnet,
      rpcUrl: defaultRpcUrls.mainnet,
      name: 'Ethereum Mainnet',
      chainId: 1,
      chainType: 'evm'
    });

    // 以太坊测试网 (Sepolia)
    this.chainConfigs.set('sepolia', {
      chain: sepolia,
      rpcUrl: defaultRpcUrls.sepolia,
      name: 'Ethereum Sepolia',
      chainId: 11155111,
      chainType: 'evm'
    });

    // BSC 主网
    this.chainConfigs.set('bsc', {
      chain: bsc,
      rpcUrl: defaultRpcUrls.bsc,
      name: 'BNB Smart Chain',
      chainId: 56,
      chainType: 'evm'
    });

    // BSC 测试网
    this.chainConfigs.set('bscTestnet', {
      chain: bscTestnet,
      rpcUrl: defaultRpcUrls.bscTestnet,
      name: 'BNB Smart Chain Testnet',
      chainId: 97,
      chainType: 'evm'
    });

    // 本地开发网络
    this.chainConfigs.set('localhost', {
      chain: localhost,
      rpcUrl: defaultRpcUrls.localhost,
      name: 'Localhost',
      chainId: 31337,
      chainType: 'evm'
    });

    // Solana 本地测试网
    this.chainConfigs.set('solana', {
      chain: null,  // Solana 不使用 viem chain
      rpcUrl: defaultRpcUrls.solana,
      name: 'Solana Local',
      chainId: 900,
      chainType: 'solana'
    });
  }

  /**
   * 获取指定链的配置
   */
  public getChainConfig(chain: SupportedChain): ChainConfig | undefined {
    return this.chainConfigs.get(chain);
  }

  /**
   * 获取所有支持的链
   */
  public getSupportedChains(): SupportedChain[] {
    return Array.from(this.chainConfigs.keys());
  }

  /**
   * 根据chainId获取对应的链类型
   */
  public getChainByChainId(chainId: number): SupportedChain {
    switch (chainId) {
      case 1:
        return 'mainnet';
      case 11155111:
        return 'sepolia';
      case 56:
        return 'bsc';
      case 97:
        return 'bscTestnet';
      case 1337:
      case 31337:
        return 'localhost';
      case 900:
        return 'solana';
      default:
        throw new Error(`Unsupported chainId: ${chainId}`);
    }
  }

  /**
   * 获取指定链的公共客户端
   */
  public getPublicClient(chain: SupportedChain): any {
    if (!this.publicClients.has(chain)) {
      const config = this.chainConfigs.get(chain);
      if (!config) {
        throw new Error(`Unsupported chain: ${chain}`);
      }

      const client = createPublicClient({
        chain: config.chain,
        transport: http(config.rpcUrl)
      });

      this.publicClients.set(chain, client);
    }

    return this.publicClients.get(chain);
  }

  /**
   * 清除公共客户端缓存（用于测试或重新配置）
   */
  public clearPublicClientCache(): void {
    this.publicClients.clear();
  }

  /**
   * 获取指定地址的 nonce
   */
  async getNonce(address: string, chainId: number): Promise<number> {
    const chain = this.getChainByChainId(chainId);
    const publicClient = this.getPublicClient(chain);
    
    try {
      const nonce = await publicClient.getTransactionCount({
        address: address as `0x${string}`,
        blockTag: 'pending' // 使用 pending 状态获取最新的 nonce
      });
      
      return nonce;
    } catch (error) {
      console.error('获取 nonce 失败:', error);
      throw new Error(`无法获取地址 ${address} 的 nonce`);
    }
  }

  /**
   * 获取当前网络状态信息
   */
  async getNetworkInfo(chainId: number): Promise<{
    chainId: number;
    blockNumber: bigint;
    baseFeePerGas: bigint;
    gasPrice: bigint;
    networkCongestion: 'low' | 'medium' | 'high';
  }> {
    const chain = this.getChainByChainId(chainId);
    const publicClient = this.getPublicClient(chain);
    const config = this.getChainConfig(chain);
    
    try {
      const [block, gasPrice] = await Promise.all([
        publicClient.getBlock({ blockTag: 'latest' }),
        publicClient.getGasPrice()
      ]);

      const baseFeePerGas = block.baseFeePerGas || BigInt(0);
      const networkCongestion = this.assessNetworkCongestion(baseFeePerGas);

      return {
        chainId: config?.chainId || 1,
        blockNumber: block.number,
        baseFeePerGas,
        gasPrice,
        networkCongestion
      };
    } catch (error) {
      console.error('获取网络信息失败:', error);
      throw new Error('无法获取网络信息');
    }
  }

  /**
   * 评估网络拥堵程度
   */
  private assessNetworkCongestion(baseFeePerGas: bigint): 'low' | 'medium' | 'high' {
    if (baseFeePerGas > parseUnits('10', 9)) {
      return 'high';
    } else if (baseFeePerGas > parseUnits('5', 9)) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * 获取 Solana RPC 客户端
   */
  public getSolanaRpc(): Rpc<any> {
    if (!this.solanaRpcClient) {
      const config = this.chainConfigs.get('solana');
      if (!config) {
        throw new Error('Solana chain config not found');
      }
      this.solanaRpcClient = createSolanaRpc(config.rpcUrl);
    }
    return this.solanaRpcClient;
  }
}

// 导出便利函数
export const chainConfigManager = ChainConfigManager.getInstance();
