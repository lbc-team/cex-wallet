import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config();

export interface Config {
  // 以太坊节点配置
  ethRpcUrl: string;
  ethRpcUrlBackup?: string;
  
  // 数据库配置
  databaseUrl: string;
  
  // 扫描配置
  startBlock: number;
  confirmationBlocks: number;
  scanBatchSize: number;
  reorgCheckDepth: number;
  scanInterval: number;
  maxConcurrentRequests: number;
  
  // 服务配置
  logLevel: string;
}

const config: Config = {
  // 以太坊节点配置
  ethRpcUrl: process.env.ETH_RPC_URL || '',
  ethRpcUrlBackup: process.env.ETH_RPC_URL_BACKUP,
  
  // 数据库配置
  databaseUrl: process.env.DATABASE_URL || path.join(__dirname, '../../../wallet/wallet.db'),
  
  // 扫描配置
  startBlock: parseInt(process.env.START_BLOCK || '1'),
  confirmationBlocks: parseInt(process.env.CONFIRMATION_BLOCKS || '32'),
  scanBatchSize: parseInt(process.env.SCAN_BATCH_SIZE || '10'),
  reorgCheckDepth: parseInt(process.env.REORG_CHECK_DEPTH || '64'),
  scanInterval: parseInt(process.env.SCAN_INTERVAL || '12'),
  maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || '5'),
  
  // 服务配置
  logLevel: process.env.LOG_LEVEL || 'info'
};

// 验证必需的配置
if (!config.ethRpcUrl) {
  throw new Error('ETH_RPC_URL 环境变量是必需的');
}

export default config;
