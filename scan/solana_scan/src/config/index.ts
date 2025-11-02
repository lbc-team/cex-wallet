import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

export interface Config {
  // Solana节点配置
  solanaRpcUrl: string;
  solanaRpcUrlBackup?: string;

  // 数据库配置
  databaseUrl: string;

  // 扫描配置
  startSlot: number;
  confirmationThreshold: number;
  scanInterval: number;

  // 服务配置
  logLevel: string;
}

const config: Config = {
  // Solana节点配置
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'http://localhost:8899',
  solanaRpcUrlBackup: process.env.SOLANA_RPC_URL_BACKUP,

  // 数据库配置
  databaseUrl: process.env.WALLET_DB_PATH || '',

  // 扫描配置
  startSlot: parseInt(process.env.START_SLOT || '0'),
  confirmationThreshold: parseInt(process.env.CONFIRMATION_THRESHOLD || '32'),
  scanInterval: parseInt(process.env.SCAN_INTERVAL || '2'),

  // 服务配置
  logLevel: process.env.LOG_LEVEL || 'info'
};

// 验证必需的配置
if (!config.solanaRpcUrl) {
  throw new Error('SOLANA_RPC_URL 环境变量是必需的');
}

export default config;
