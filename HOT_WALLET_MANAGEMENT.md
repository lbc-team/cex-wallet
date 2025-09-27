# 内部钱包管理指南

## 概述

内部钱包系统用于管理所有内部钱包（热钱包、多签钱包、冷钱包、金库钱包等），支持高并发提现场景下的 nonce 管理。**内部钱包仅供内部使用，不对外提供 API 接口**。

## 功能特性

- ✅ 原子性 nonce 管理，避免并发冲突
- ✅ 智能内部钱包选择，负载均衡
- ✅ 支持多链和多种钱包类型（热钱包、多签钱包、冷钱包、金库钱包）
- ✅ 自动重试机制
- ✅ 缓存优化
- ✅ 批量操作支持

## 管理方式

### 1. 命令行管理脚本

使用 `src/scripts/internalWalletManager.ts` 脚本进行管理：

```bash
# 显示帮助信息
node -r ts-node/register src/scripts/internalWalletManager.ts help

# 通过签名机创建热钱包
node -r ts-node/register src/scripts/internalWalletManager.ts create-hot 1 evm

# 创建多签钱包
node -r ts-node/register src/scripts/internalWalletManager.ts create-internal 0x1234... 1 evm multisig

# 批量创建内部钱包（示例脚本）
node -r ts-node/register src/scripts/createHotWallets.ts

# 获取内部钱包列表
node -r ts-node/register src/scripts/internalWalletManager.ts list

# 激活内部钱包
node -r ts-node/register src/scripts/internalWalletManager.ts activate 0x1234... 1

# 同步 nonce
node -r ts-node/register src/scripts/internalWalletManager.ts sync 0x1234... 1 100
```

### 2. 程序化管理

```typescript
import { InternalWalletManager } from './src/scripts/internalWalletManager';

const manager = new InternalWalletManager();

// 通过签名机创建热钱包
await manager.createHotWallet({
  chainType: 'evm',
  chainId: 1,
  initialNonce: 0
});

// 创建多签钱包
await manager.createInternalWallet({
  address: '0x1234...',
  chainType: 'evm',
  chainId: 1,
  walletType: 'multisig',
  initialNonce: 0
});

// 获取内部钱包列表
const wallets = await manager.getInternalWallets(1);

// 同步 nonce
await manager.syncNonce('0x1234...', 1, 100);
```

## 数据库表结构

### internal_wallets 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| address | TEXT | 钱包地址，唯一 |
| device | TEXT | 来自哪个签名机设备地址 |
| path | TEXT | 推导路径 |
| chain_type | TEXT | 地址类型：evm、btc、solana |
| chain_id | INTEGER | 链ID，如 1(以太坊主网)、56(BSC) |
| wallet_type | TEXT | 钱包类型：hot(热钱包)、multisig(多签钱包)、cold(冷钱包)、vault(金库钱包) |
| nonce | INTEGER | 当前 nonce 值，用于交易排序 |
| is_active | INTEGER | 是否激活：0-未激活，1-激活 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

## 使用场景

### 1. 用户提现流程

```typescript
// 用户提现时，系统自动选择最优热钱包
const hotWallet = await hotWalletService.selectOptimalHotWallet(chainId, chainType);

// 获取 nonce（原子性操作）
const nonce = await hotWalletService.getNextNonceWithRetry(hotWallet.address, chainId);

// 使用热钱包进行转账
const transaction = await signerService.signTransaction({
  address: hotWallet.address,
  to: userAddress,
  amount: withdrawAmount,
  nonce: nonce,
  // ... 其他参数
});
```

### 2. Nonce 管理策略

- **原子性更新**: 使用数据库原子性操作避免并发冲突
- **重试机制**: 冲突时自动重试，最多 3 次
- **智能选择**: 优先选择 nonce 最低的热钱包
- **缓存优化**: 内存缓存减少数据库查询

### 3. 负载均衡

```typescript
// 系统会根据以下策略选择热钱包：
// 1. 可用性检查 (is_active = 1)
// 2. 链类型匹配 (chain_type, chain_id)
// 3. Nonce 排序 (选择 nonce 最低的)
// 4. 负载均衡 (轮询选择)
```

## 监控和维护

### 1. 健康检查

```bash
# 检查 nonce 健康状态
node -r ts-node/register src/scripts/hotWalletManager.ts health 0x1234... 1 100
```

### 2. 缓存管理

```bash
# 查看缓存状态
node -r ts-node/register src/scripts/hotWalletManager.ts cache-status

# 清理缓存
node -r ts-node/register src/scripts/hotWalletManager.ts clear-cache
```

### 3. 批量操作

```bash
# 批量同步 nonce
node -r ts-node/register src/scripts/hotWalletManager.ts batch-sync nonces.json
```

## 安全注意事项

1. **内部使用**: 热钱包管理脚本仅供系统管理员使用
2. **权限控制**: 确保只有授权人员可以访问管理脚本
3. **审计日志**: 所有热钱包操作都有日志记录
4. **备份恢复**: 定期备份热钱包配置和 nonce 状态

## 故障处理

### 1. Nonce 冲突

```bash
# 同步 nonce 从链上
node -r ts-node/register src/scripts/hotWalletManager.ts sync 0x1234... 1 100
```

### 2. 热钱包不可用

```bash
# 检查热钱包状态
node -r ts-node/register src/scripts/hotWalletManager.ts info 0x1234... 1

# 激活热钱包
node -r ts-node/register src/scripts/hotWalletManager.ts activate 0x1234... 1
```

### 3. 缓存问题

```bash
# 清理缓存
node -r ts-node/register src/scripts/hotWalletManager.ts clear-cache
```

## 性能优化

1. **连接池**: 使用数据库连接池提高并发性能
2. **缓存策略**: 内存缓存减少数据库查询
3. **批量操作**: 支持批量同步 nonce
4. **异步处理**: 非阻塞的异步操作

## 扩展性

- 支持多链扩展
- 支持多种钱包类型
- 支持自定义负载均衡策略
- 支持监控和告警集成
