# CEX钱包系统 - 区块链扫描器

以太坊区块链扫描器后台服务，用于监控用户钱包地址的存款交易，支持ETH和ERC20代币，具备区块重组检测和确认机制。 

## 功能特性

- 🔍 **智能区块扫描**: 批量同步扫描，自动追赶最新区块
- 💰 **存款检测**: 自动检测用户地址的ETH和ERC20代币存款
- ⚡ **完整重组处理**: 区块哈希连续性验证、分叉检测、共同祖先回滚
- ✅ **确认机制**: 基于区块确认数的安全确认机制
- 🔄 **数据恢复**: 自动数据库清理和余额恢复机制
- 📊 **进度追踪**: 基于blocks表的扫描进度管理，含重组统计
- 🛡️ **容错处理**: 网络中断恢复、RPC节点切换、错误重试
- 📊 **监控日志**: 详细的结构化日志记录

## 技术架构

### 核心组件

1. **区块扫描器 (BlockScanner)**: 智能扫描区块链，集成交易确认处理
2. **重组处理器 (ReorgHandler)**: 完整的区块链重组检测和处理机制
3. **交易分析器 (TransactionAnalyzer)**: 分析区块中的交易，检测用户存款
4. **扫描服务 (ScanService)**: 统一的后台扫描服务
5. **Viem客户端 (ViemClient)**: 以太坊RPC客户端，支持节点切换

### 扫描流程

```
1. 获取扫描进度(从blocks表) → 2. 批量扫描区块 → 3. 重组检测 → 4. 分析交易
                                      ↓              ↓
8. 启动定时扫描 ← 7. 追上最新区块 ← 6. 确认处理 ← 5. 检测存款
```

最简单的的方式是仅处理安全的区块，但是入账时，延迟较大。

### 扫描逻辑

1. **初始化**: 从配置的 `START_BLOCK` 或数据库 `blocks` 表获取最后扫描的区块
2. **批量同步**: 一次扫描 `SCAN_BATCH_SIZE` 个区块，直到扫描到当前最高区块
3. **重组检测**: 每个区块都进行哈希连续性验证和分叉检测
4. **集成处理**: 扫描过程中同步进行交易确认和余额更新
5. **定时扫描**: 只有追上最新区块后才启动间隔任务(`SCAN_INTERVAL`)
6. **状态追踪**: 通过 `blocks` 表记录扫描进度，无需额外的状态表

### 重组处理机制

1. **区块哈希连续性验证**: 检查每个区块哈希及其父区块链的连续性
2. **分叉检测**: 深度检查 `REORG_CHECK_DEPTH` 个区块发现分叉
3. **共同祖先查找**: 向前搜索找到数据库和链上哈希匹配的区块
4. **数据回滚**: 回滚从共同祖先之后的所有区块和交易数据
5. **余额恢复**: 根据交易确认状态正确恢复用户余额
6. **正确链同步**: 重新扫描正确链上的区块数据
7. **数据库清理**: 清理孤立区块和相关交易记录

## 安装部署

### 环境要求

- Node.js 18+
- TypeScript 5+
- SQLite 3

### 安装依赖

```bash
cd scan
npm install
```

### 环境配置

创建 `.env` 文件：

```bash
# 以太坊 RPC 节点 URL (必需)
ETH_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/YOUR_API_KEY

# 替代 RPC URLs (可选，用作备份)
ETH_RPC_URL_BACKUP=https://mainnet.infura.io/v3/YOUR_PROJECT_ID

# 数据库文件路径 (必需)
DATABASE_URL=../wallet/wallet.db

# 扫描起始区块 (可选，默认为 1)
START_BLOCK=1

# 确认区块数 (可选，默认为 32)
CONFIRMATION_BLOCKS=32

# 扫描批次大小 (可选，默认为 10)
SCAN_BATCH_SIZE=10

# 重组检查深度 (可选，默认为 64)
REORG_CHECK_DEPTH=64

# 扫描间隔 (秒，可选，默认为 12)
SCAN_INTERVAL=12

# RPC 请求并发数 (可选，默认为 5)
MAX_CONCURRENT_REQUESTS=5

# 日志级别 (可选，默认为 info)
LOG_LEVEL=info
```

### 初始化数据库

**自动创建**: wallet 服务启动时会自动创建所需的数据库表，无需手动执行脚本。

如果需要手动创建表（可选）：

```bash
# 在 wallet 目录下执行
cd ../wallet
npm run build
node dist/scripts/createTables.js
```

### 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
```

## 服务管理

这是一个纯后台服务，通过日志文件和进程信号进行管理：

### 启动服务
```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
```

### 停止服务
```bash
# 发送 SIGINT 信号（Ctrl+C）
kill -INT <process_id>

# 发送 SIGTERM 信号
kill -TERM <process_id>
```

### 监控服务
- 通过日志文件监控服务状态
- 进程每5分钟输出内存使用情况
- 所有扫描活动都会记录在日志中

## 数据库结构

### 区块表 (blocks)
| 字段 | 类型 | 说明 |
|------|------|------|
| hash | TEXT | 区块哈希 (主键) |
| parent_hash | TEXT | 父区块哈希 |
| number | TEXT | 区块号 |
| timestamp | INTEGER | 区块时间戳 |
| status | TEXT | 区块状态 (confirmed/orphaned) |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### 交易表扩展字段
- `confirmation_count`: 确认数
- `block_hash`: 所属区块哈希
- `block_no`: 区块号
- `status`: 交易状态 (confirmed/safe/finalized/failed)

### 交易状态流程
```
confirmed (入库默认状态) → safe (12个确认) → finalized (24个确认) → 更新余额
```

| 状态 | 确认数 | 说明 |
|------|--------|------|
| confirmed | 0+ | 交易已上链，默认状态 |
| safe | 12+ | 交易相对安全，不易被重组 |
| finalized | 24+ | 交易最终确认，更新用户余额 |
| failed | - | 交易执行失败或被重组回滚 |

### 扫描进度管理
- 通过查询 `blocks` 表的最大区块号获取扫描进度
- 无需额外的状态表，简化数据库结构

## 监控和日志

### 日志文件

- `logs/combined.log`: 所有日志
- `logs/error.log`: 错误日志

### 监控指标

- **扫描延迟**: 当前区块与最新区块的差距
- **处理速度**: 每分钟处理的区块数
- **错误率**: 失败请求的比例
- **重组统计**: 
  - 孤立区块数量
  - 回滚交易数量
  - 重组事件频率
- **确认状态**: 待确认交易数量
- **内存使用**: 服务进程内存占用

## 故障排除

### 常见问题

1. **RPC连接失败**
   - 检查 `ETH_RPC_URL` 配置
   - 验证API密钥是否正确
   - 检查网络连接

2. **扫描延迟过大**
   - 增加 `MAX_CONCURRENT_REQUESTS`
   - 减少 `SCAN_BATCH_SIZE`
   - 检查RPC服务性能

3. **数据库问题**
   - 确保 wallet 服务已启动过（自动创建数据库表）
   - 检查数据库文件权限
   - 确保没有其他进程占用数据库
   - 可选：手动运行 `createTables.js` 脚本

4. **内存使用过高**
   - 减少扫描批次大小
   - 降低并发请求数
   - 增加服务器内存

5. **重组处理异常**
   - 检查 `REORG_CHECK_DEPTH` 配置是否合理
   - 验证RPC节点数据一致性
   - 确认数据库写入权限

### 日志分析

```bash
# 查看错误日志
tail -f logs/error.log

# 查看最近的扫描活动
grep "扫描" logs/combined.log | tail -20

# 查看重组事件
grep "重组" logs/combined.log

# 查看区块扫描统计
grep "区块扫描完成" logs/combined.log | tail -10

# 监控内存使用
grep "内存使用情况" logs/combined.log | tail -5
```

## 性能优化

### 配置调优

```bash
# 高性能配置（适用于专用服务器）
SCAN_BATCH_SIZE=20
MAX_CONCURRENT_REQUESTS=10
SCAN_INTERVAL=15

# 低资源配置（适用于共享服务器）
SCAN_BATCH_SIZE=5
MAX_CONCURRENT_REQUESTS=3
SCAN_INTERVAL=60
```

### 数据库优化

- 定期清理旧的孤块记录
- 为常用查询字段创建索引
- 定期备份数据库

## 重组处理详解

### 重组检测原理

重组检测基于区块哈希连续性验证：
1. **单区块检测**: 比较数据库中的区块哈希与链上区块哈希
2. **父链验证**: 检查前 `REORG_CHECK_DEPTH` 个区块的连续性
3. **父子关系**: 验证 `parentHash` 与前一区块 `hash` 的匹配

### 重组处理流程

```
重组检测 → 寻找共同祖先 → 数据回滚 → 重新同步 → 数据清理
    ↓            ↓           ↓         ↓         ↓
区块哈希    向前搜索匹配   回滚区块/交易  重扫正确链  清理孤块
连续性验证    的区块        恢复余额     更新数据   删除记录
```

### 重组统计监控

可通过扫描进度API获取重组统计：
- `totalReorgs`: 总重组次数
- `orphanedBlocks`: 孤立区块数量  
- `revertedTransactions`: 回滚交易数量

### 重组配置建议

- **主网**: `REORG_CHECK_DEPTH=64` (约10分钟)
- **测试网**: `REORG_CHECK_DEPTH=32` (约5分钟)
- **私链**: `REORG_CHECK_DEPTH=10` (根据出块时间调整)

## 安全考虑

- RPC URL包含敏感信息，不要泄露
- 使用HTTPS连接RPC服务
- 限制API访问权限
- 定期更新依赖包版本
- 备份数据库以防重组处理异常

## 开发和测试

### 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev:watch
```

### 测试

```bash
# 运行测试
npm test

# 测试特定功能
curl http://localhost:3002/api/scan/status
```

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 创建 Pull Request

## 许可证

MIT License
