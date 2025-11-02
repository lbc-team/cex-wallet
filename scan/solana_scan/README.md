# Solana Scan Module

Solana区块链扫描器 - CEX钱包系统

## 功能特点

- **实时扫块**: 使用 `@solana/kit` 库连接本地测试节点或主网节点进行实时扫块
- **多代币支持**: 支持 SOL 原生代币、SPL Token 和 SPL Token 2022 的转账解析（Token 2022暂未测试）
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
   - 从 instructions/innerInstructions 中提取转账信息

3. **BlockScanner** (`src/services/blockScanner.ts`)
   - 管理扫块流程
   - 处理槽位回滚
   - 标记跳过的槽位

4. **DbGatewayClient** (`src/services/dbGatewayClient.ts`)
   - 与 db_gateway 服务交互
   - 处理 Solana 槽位和交易记录的存储
   - 管理 credit 记录

## 数据库表

参考DB Gateway [database.md](../../db_gateway/database.md)

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


### 转账解析逻辑

#### 1. SOL 转账
- 解析 System Program 的 **parsed instructions**
- 检查指令类型是否为 `transfer`
- 从 `parsed.info` 中提取 `destination`（接收地址）、`source`（发送地址）、`lamports`（金额）
- 只处理目标地址在监控列表中的转账

#### 2. SPL Token / SPL Token 2022 转账
- 解析 `instructions` 和 `innerInstructions` 中的 Token Program 调用
- 支持 `transfer` 和 `transferChecked` 指令
- **关键**：转账目标是 ATA (Associated Token Account) 地址，需要通过 `solana_token_accounts` 表映射回钱包地址
- Mint 地址获取策略（优先级从高到低）：
  1. `transferChecked` 指令的 `info.mint`（最直接）
  2. 从缓存的 `ataToMintMap` 获取（性能最优）
  3. 从 `postTokenBalances` / `preTokenBalances` 提取（备用方案，适用于新创建的 ATA）
- 只保留钱包地址在监控列表中的转账


### 回滚处理

Solana 的回滚较少见，在实时性要求不高的情况下，可以直接同步 finalized 的区块。如果要应对回滚的话，由于 Solana 与以太坊"区块头 + 交易列表 + 父区块哈希"结构不一样，Solana 基于 PoH（Proof of History）时间序列 + slot 机制来组织数据，在区块结构中没有 parentHash 这样的共识字段。我们需要定期重新验证区块的 hash 是否变更。


**检测机制**（定期重新验证 - 优化版）：

1. **增量检查策略**:
   - 先检查**最新的** confirmed 槽位
   - 如果最新的槽位没有变化 → **直接退出检查**，无需检查其余槽位
   - 如果最新的槽位有变化 → 继续向上检查，直到找到稳定的槽位
   - 最多检查 `CONFIRMATION_THRESHOLD` 个槽位（默认 32 个）
   - 参考代码：`scan/solana_scan/src/services/blockScanner.ts:revalidateRecentConfirmedSlots()`


2. **检测两种回滚情况**:
   - **情况 1**: 槽位从有区块变成 skipped（区块消失）
     - 数据库中有 block_hash，但链上查询返回 null
   - **情况 2**: 区块哈希改变（区块内容变化）
     - 链上的 blockhash 与数据库中的 block_hash 不一致

3. **回滚处理**:
   - 删除受影响槽位的 credit 记录（通过 `deleteCreditsBySlotRange`）
   - 删除受影响槽位的 transaction 记录（通过 `deleteSolanaTransactionsBySlot`）
   - 将槽位状态更新为 `skipped`


## 监控和调试

### 日志文件

- `logs/combined.log`: 所有日志
- `logs/error.log`: 错误日志


## 开发和测试

```bash
# 运行开发模式（带热重载）
npm run dev:watch

# 构建
npm run build

# 清理
npm run clean
```


