# Solana Scan Module

Solana区块链扫描器 - CEX钱包系统

## 功能特点

- **实时扫块**: 使用 `@solana/web3.js` 库连接本地测试节点或主网节点进行实时扫块
- **多代币支持**: 支持 SOL 原生代币、SPL Token 和 SPL Token 2022 的转账解析
- **回滚处理**: 处理 Solana 的槽位回滚（虽然较少见但可能发生）
- **断点续扫**: 支持从上次扫描位置继续扫描
- **批量处理**: 批量获取和处理槽位，提高扫描效率

## 架构设计

### 核心组件

1. **SolanaClient** (`src/utils/solanaClient.ts`)
   - 封装 Solana RPC 调用
   - 支持主备节点切换
   - 提供槽位和区块查询功能

2. **TransactionParser** (`src/services/txParser.ts`)
   - 解析 SOL 原生转账
   - 解析 SPL Token 转账 (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
   - 解析 SPL Token 2022 转账 (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)
   - 从 preBalances/postBalances 和 instructions/innerInstructions 中提取转账信息

3. **BlockScanner** (`src/services/blockScanner.ts`)
   - 管理扫块流程
   - 处理槽位回滚
   - 标记跳过的槽位

4. **DbGatewayClient** (`src/services/dbGatewayClient.ts`)
   - 与 db_gateway 服务交互
   - 处理 Solana 槽位和交易记录的存储
   - 管理 credit 记录

## 数据库表

### solana_slots 表
```sql
CREATE TABLE solana_slots (
  slot INTEGER PRIMARY KEY,
  block_hash TEXT,
  parent_slot INTEGER,
  block_time INTEGER,
  status TEXT DEFAULT 'confirmed',  -- confirmed/finalized/skipped
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### solana_transactions 表
```sql
CREATE TABLE solana_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot INTEGER,                      -- 槽位号
  tx_hash TEXT UNIQUE NOT NULL,      -- 交易签名
  from_addr TEXT,                    -- 发起地址
  to_addr TEXT,                      -- 接收地址
  token_mint TEXT,                   -- SPL Token Mint地址 (NULL表示SOL)
  amount TEXT,                       -- 交易金额
  type TEXT,                         -- deposit/withdraw/collect/rebalance
  status TEXT DEFAULT 'confirmed',   -- confirmed/finalized/failed
  block_time INTEGER,                -- 区块时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

注意：Solana交易使用独立的表，与EVM链的 `transactions` 表分离

## 安装和配置

### 1. 安装依赖

```bash
cd /Users/emmett/openspace_code/cex-wallet/scan/solana_scan
npm install
```

### 2. 配置环境变量

复制 `.env.example` 到 `.env` 并配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# Solana RPC Configuration
SOLANA_RPC_URL=http://localhost:8899  # 本地测试节点
# SOLANA_RPC_URL=https://api.mainnet-beta.solana.com  # 主网

# Database Configuration
WALLET_DB_PATH=../../db_gateway/wallet.db

# Scan Configuration
START_SLOT=0
CONFIRMATION_THRESHOLD=32
SCAN_BATCH_SIZE=10
SCAN_INTERVAL=2

# DB Gateway Configuration
DB_GATEWAY_URL=http://localhost:3003
DB_GATEWAY_SECRET=your-secret-key-here

# Log Level
LOG_LEVEL=info
```

### 3. 启动本地 Solana 测试节点

```bash
# 使用 solana-test-validator
solana-test-validator

# 或者连接到 devnet/mainnet
# SOLANA_RPC_URL=https://api.devnet.solana.com
```

### 4. 运行扫描器

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
```

## 主要流程

### 扫块流程伪代码

```typescript
while (true) {
  const slot = await waitForNextSlot(lastSlot + 1);
  const block = await rpc.getBlock(slot, { maxSupportedTransactionVersion: 0 });

  // 解析交易
  const parsedDeposits = parseBlock(block);

  // 展开 tx -> instructions 和 innerInstructions
  // 解析 SOL 转账（从 preBalances/postBalances）
  // 解析 SPL Token 转账（从 instructions）
  // 解析 SPL Token 2022 转账（从 instructions）

  // 写入数据库
  await writeDepositsToDB(parsedDeposits);

  lastSlot = slot;
  setCursor("block_slot", lastSlot);
}
```

### 转账解析逻辑

#### 1. SOL 转账
- 比较 `preBalances` 和 `postBalances`
- 余额增加的账户为接收方
- 余额减少的账户为发送方

#### 2. SPL Token / SPL Token 2022 转账
- 解析 `instructions` 中的 Token Program 调用
- 支持 `transfer` 和 `transferChecked` 指令
- 从 `innerInstructions` 中提取内部转账
- 使用 `preTokenBalances` 和 `postTokenBalances` 作为备用方案

### 回滚处理

Solana 的回滚较少见，但在网络分叉时可能发生：

1. **检测回滚**: 定期检查最近的槽位是否仍然存在于链上
2. **回滚操作**:
   - 删除受影响槽位的 credit 记录
   - 删除受影响槽位的 transaction 记录
   - 将槽位状态标记为 `skipped`
3. **重新扫描**: 从回滚点重新扫描新的区块

## 监控和调试

### 日志文件

- `logs/combined.log`: 所有日志
- `logs/error.log`: 错误日志

### 健康检查

```typescript
const health = await scanService.getHealthStatus();
console.log(health);
// {
//   status: 'healthy',
//   details: {
//     scanDelay: 10,
//     currentSlot: 123456,
//     latestSlot: 123466
//   }
// }
```

## 注意事项

1. **Solana 槽位**: Solana 使用槽位（slot）而不是区块号，某些槽位可能被跳过（skipped）
2. **Token Program ID**: 支持 Token Program 和 Token-2022 Program
3. **性能优化**: 使用批量获取槽位（`getBlocks`）减少 RPC 调用
4. **回滚频率**: Solana 的回滚比 EVM 链少得多，但仍需处理

## 开发和测试

```bash
# 运行开发模式（带热重载）
npm run dev:watch

# 构建
npm run build

# 清理
npm run clean
```

## License

MIT
