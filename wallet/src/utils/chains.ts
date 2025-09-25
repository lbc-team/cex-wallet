import { createPublicClient, http } from 'viem';
import { mainnet, sepolia, bsc, bscTestnet, localhost } from 'viem/chains';

// 支持的链类型
export type SupportedChain = 'mainnet' | 'sepolia' | 'bsc' | 'bscTestnet' | 'localhost';

// 链配置接口
export interface ChainConfig {
  chain: any;
  rpcUrl: string;
  name: string;
  chainId: number;
}

/**
 * 统一的链配置管理
 */
export class ChainConfigManager {
  private static instance: ChainConfigManager;
  private chainConfigs: Map<SupportedChain, ChainConfig> = new Map();
  private publicClients: Map<SupportedChain, any> = new Map();

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
      localhost: process.env.LOCALHOST_RPC_URL || 'http://127.0.0.1:8545'
    };

    // 以太坊主网
    this.chainConfigs.set('mainnet', {
      chain: mainnet,
      rpcUrl: defaultRpcUrls.mainnet,
      name: 'Ethereum Mainnet',
      chainId: 1
    });

    // 以太坊测试网 (Sepolia)
    this.chainConfigs.set('sepolia', {
      chain: sepolia,
      rpcUrl: defaultRpcUrls.sepolia,
      name: 'Ethereum Sepolia',
      chainId: 11155111
    });

    // BSC 主网
    this.chainConfigs.set('bsc', {
      chain: bsc,
      rpcUrl: defaultRpcUrls.bsc,
      name: 'BNB Smart Chain',
      chainId: 56
    });

    // BSC 测试网
    this.chainConfigs.set('bscTestnet', {
      chain: bscTestnet,
      rpcUrl: defaultRpcUrls.bscTestnet,
      name: 'BNB Smart Chain Testnet',
      chainId: 97
    });

    // 本地开发网络
    this.chainConfigs.set('localhost', {
      chain: localhost,
      rpcUrl: defaultRpcUrls.localhost,
      name: 'Localhost',
      chainId: 31337
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
}

// 导出便利函数
export const chainConfigManager = ChainConfigManager.getInstance();
