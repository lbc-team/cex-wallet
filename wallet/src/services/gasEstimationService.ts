import { createPublicClient, http, parseUnits } from 'viem';
import { mainnet } from 'viem/chains';

// Gas 费用估算结果接口
export interface GasEstimation {
  // EIP-1559 参数
  maxFeePerGas: string;           // 最大费用
  maxPriorityFeePerGas: string;   // 最大优先费用
  baseFeePerGas: string;          // 当前基础费用
  
  // Gas 限制
  gasLimit: string;               // 预估的 gas 限制
  
  // Legacy 参数（备用）
  gasPrice: string;               // Legacy gas 价格
  
  // 交易类型和网络信息
  transactionType: 2 | 0;         // 推荐的交易类型
  networkCongestion: 'low' | 'medium' | 'high'; // 网络拥堵程度
}

/**
 * Gas 费用估算服务
 * 动态从以太坊网络获取最优的 gas 参数
 */
export class GasEstimationService {
  private publicClient: ReturnType<typeof createPublicClient>;
  private rpcUrl: string;

  constructor() {
    // 从环境变量获取 RPC URL，默认使用免费的公共节点
    this.rpcUrl = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';
    this.publicClient = createPublicClient({
      chain: mainnet,
      transport: http(this.rpcUrl)
    });
  }

  /**
   * 估算 ETH 转账的 gas 费用
   */
  async estimateEthTransfer(params: {
    from: string;
    to: string;
    amount: string; // wei 单位
  }): Promise<GasEstimation> {
    try {
      // 1. 从历史数据获取所有费用信息
      const [baseFeePerGas, gasPrice, priorityFee] = await this.getFeeDataFromHistory();

      // 2. 使用配置的 gas 限制
      const gasLimit = 21000n; // ETH 转账的标准 gas

      // 3. 计算 EIP-1559 费用
      const maxFeePerGas = baseFeePerGas * 2n + priorityFee; // 2倍基础费用 + 优先费用

      // 4. 判断网络拥堵程度
      const networkCongestion = this.assessNetworkCongestion(baseFeePerGas);

      return {
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: priorityFee.toString(),
        baseFeePerGas: baseFeePerGas.toString(),
        gasLimit: gasLimit.toString(),
        gasPrice: gasPrice.toString(),
        transactionType: 2, // 优先使用 EIP-1559
        networkCongestion
      };

    } catch (error) {
      console.error('Gas 估算失败:', error);
      // 返回保守的默认值
      return this.getDefaultGasEstimation();
    }
  }

  /**
   * 估算 ERC20 转账的 gas 费用
   */
  async estimateErc20Transfer(params: {
    from: string;
    to: string;
    tokenAddress: string;
    amount: string; // 最小单位
  }): Promise<GasEstimation> {
    try {
      // 1. 从历史数据获取所有费用信息
      const [baseFeePerGas, gasPrice, priorityFee] = await this.getFeeDataFromHistory();

      // 2. 编码 ERC20 transfer 调用数据
      const transferData = this.encodeERC20Transfer(params.to, params.amount);

      // 3. 使用配置的 gas 限制
      const gasLimit = 60000n; // ERC20 转账的配置 gas 限制

      // 4. 计算 EIP-1559 费用
      const maxFeePerGas = baseFeePerGas * 2n + priorityFee;

      // 5. 判断网络拥堵程度
      const networkCongestion = this.assessNetworkCongestion(baseFeePerGas);

      return {
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: priorityFee.toString(),
        baseFeePerGas: baseFeePerGas.toString(),
        gasLimit: gasLimit.toString(),
        gasPrice: gasPrice.toString(),
        transactionType: 2,
        networkCongestion
      };

    } catch (error) {
      console.error('ERC20 Gas 估算失败:', error);
      // 返回 ERC20 的默认值
      return this.getDefaultErc20GasEstimation();
    }
  }

  /**
   * 从历史数据获取基础费用、gas 价格和优先费用
   */
  private async getFeeDataFromHistory(): Promise<[bigint, bigint, bigint]> {
    try {
      // 获取最近 20 个区块的费用历史
      const feeHistory = await this.publicClient.request({
        method: 'eth_feeHistory',
        params: [
          '0x14', // 20 个区块
          'latest',
          [10, 20, 30, 40, 50, 60, 70, 80, 90, 95] // 百分位数
        ]
      });

      // 获取最新的基础费用
      const baseFeePerGas = BigInt(feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 1]);
      
      // 获取当前 gas 价格
      const gasPrice = await this.publicClient.getGasPrice();
      
      // 分析最近 10 个区块的费用趋势
      const recentRewards = feeHistory.reward.slice(-10);
      const allRewards = recentRewards.flat().map((reward: string[]) => 
        reward.map((r: string) => BigInt(r))
      ).flat();
      
      // 计算不同百分位数的费用
      const sortedRewards = allRewards.sort((a: bigint, b: bigint) => a < b ? -1 : a > b ? 1 : 0);
      const count = sortedRewards.length;
      
      // 计算 50% 和 90% 百分位数
      const p50Index = Math.floor(count * 0.5);
      const p90Index = Math.floor(count * 0.9);
      const p50Reward = sortedRewards[p50Index];
      const p90Reward = sortedRewards[p90Index];
      
      // 根据网络状况选择策略
      const networkCongestion = this.assessNetworkCongestion(baseFeePerGas);
      
      let priorityFee: bigint;
      
      if (networkCongestion === 'high') {
        // 高拥堵时使用 90% 百分位数，确保交易被快速确认
        priorityFee = p90Reward;
      } else if (networkCongestion === 'medium') {
        // 中等拥堵时使用 70% 百分位数
        const p70Index = Math.floor(count * 0.7);
        priorityFee = sortedRewards[p70Index];
      } else {
        // 低拥堵时使用 50% 百分位数
        priorityFee = p50Reward;
      }
      
      // 确保 最大不超过 50 Gwei
      const maxPriorityFee = parseUnits('50', 9);
      
      if (priorityFee > maxPriorityFee) {
        priorityFee = maxPriorityFee;
      }
      
      return [baseFeePerGas, gasPrice, priorityFee];

    } catch (error) {
      console.warn('无法获取费用历史，使用默认值:', error);
      // 备用方案：使用当前区块数据
      const [block, gasPrice] = await Promise.all([
        this.publicClient.getBlock({ blockTag: 'latest' }),
        this.publicClient.getGasPrice()
      ]);
      const baseFeePerGas = block.baseFeePerGas || 0n;
      const priorityFee = parseUnits('2', 9); // 默认 2 Gwei
      return [baseFeePerGas, gasPrice, priorityFee];
    }
  }


  /**
   * 计算优先费用（矿工小费）- 保留原方法作为备用
   */
  private calculatePriorityFee(baseFeePerGas: bigint): bigint {
    // 根据基础费用动态调整优先费用
    if (baseFeePerGas === 0n) {
      // 如果没有基础费用信息，使用固定值
      return parseUnits('2', 9); // 2 Gwei
    }

    // 网络拥堵时增加优先费用
    if (baseFeePerGas > parseUnits('10', 9)) { // > 10 Gwei
      return parseUnits('5', 9); // 5 Gwei 高优先费用
    } else if (baseFeePerGas > parseUnits('5', 9)) { // > 5 Gwei
      return parseUnits('3', 9); // 3 Gwei 中等优先费用
    } else {
      return parseUnits('1', 9); // 1 Gwei 低优先费用
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
   * 编码 ERC20 transfer 方法调用
   */
  private encodeERC20Transfer(to: string, amount: string): `0x${string}` {
    // ERC20 transfer 方法签名: transfer(address,uint256)
    const methodId = '0xa9059cbb';
    
    // 简化的参数编码（正式环境建议使用 viem 的 encodeAbiParameters）
    const addressPadded = to.slice(2).padStart(64, '0');
    const amountHex = BigInt(amount).toString(16).padStart(64, '0');
    
    return `${methodId}${addressPadded}${amountHex}` as `0x${string}`;
  }

  /**
   * 获取默认的 Gas 估算（ETH 转账）
   */
  private getDefaultGasEstimation(): GasEstimation {
    return {
      maxFeePerGas: parseUnits('25', 9).toString(), // 25 Gwei
      maxPriorityFeePerGas: parseUnits('2', 9).toString(), // 2 Gwei
      baseFeePerGas: parseUnits('20', 9).toString(), // 20 Gwei
      gasLimit: '21000',
      gasPrice: parseUnits('25', 9).toString(), // 25 Gwei
      transactionType: 2,
      networkCongestion: 'medium'
    };
  }

  /**
   * 获取默认的 ERC20 Gas 估算
   */
  private getDefaultErc20GasEstimation(): GasEstimation {
    return {
      maxFeePerGas: parseUnits('30', 9).toString(), // 30 Gwei
      maxPriorityFeePerGas: parseUnits('2', 9).toString(), // 2 Gwei
      baseFeePerGas: parseUnits('25', 9).toString(), // 25 Gwei
      gasLimit: '60000', // 配置的 ERC20 gas 限制
      gasPrice: parseUnits('30', 9).toString(), // 30 Gwei
      transactionType: 2,
      networkCongestion: 'medium'
    };
  }

  /**
   * 获取指定地址的 nonce
   */
  async getNonce(address: string): Promise<number> {
    try {
      const nonce = await this.publicClient.getTransactionCount({
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
  async getNetworkInfo(): Promise<{
    chainId: number;
    blockNumber: bigint;
    baseFeePerGas: bigint;
    gasPrice: bigint;
    networkCongestion: 'low' | 'medium' | 'high';
  }> {
    try {
      const [block, gasPrice] = await Promise.all([
        this.publicClient.getBlock({ blockTag: 'latest' }),
        this.publicClient.getGasPrice()
      ]);

      const baseFeePerGas = block.baseFeePerGas || 0n;
      const networkCongestion = this.assessNetworkCongestion(baseFeePerGas);

      return {
        chainId: this.publicClient.chain.id,
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
}
