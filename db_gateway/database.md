## 数据库结构

### db/schema.sql
数据库结构定义文件，包含所有表、索引和视图的创建语句。

**使用方式**：
1. **自动加载**：`DatabaseService` 在初始化时会自动读取并执行此文件
2. **手动执行**：可使用 SQLite 客户端直接执行
   ```bash
   sqlite3 wallet.db < src/db/schema.sql
   ```


## 数据库设计

wallet 服务启动时会自动检查并创建所需的数据库表，包括：
- `users` - 用户表
- `wallets` - 钱包表  
- `internal_wallets` - 内部钱包表（热钱包、多签钱包等）
- `transactions` - 交易表（scan 服务使用）
- `tokens` - 代币表（scan 服务使用）
- `credits` - 资金流水表
- `withdraws` - 提现记录表
- `blocks` - 区块表（scan 服务使用）
- `used_operation_ids`

如需手动创建表，可运行：
```bash
npm run build
node dist/scripts/createTables.js
```


### 用户表 (users)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| username | TEXT | 用户名，唯一 |
| email | TEXT | 邮箱地址，唯一 |
| phone | TEXT | 手机号码 |
| password_hash | TEXT | 密码哈希 |
| user_type | TEXT | 用户类型：normal(普通用户)、sys_hot_wallet(热钱包)、sys_multisig(多签) |
| status | INTEGER | 用户状态：0-正常，1-禁用，2-待审核 |
| kyc_status | INTEGER | KYC状态：0-未认证，1-待审核，2-已认证，3-认证失败 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |
| last_login_at | DATETIME | 最后登录时间 |

**系统用户说明：**
- `user_type = 'sys_hot_wallet'`: 热钱包系统用户
- `user_type = 'sys_multisig'`: 多签钱包系统用户


### 钱包表 (wallets) - 统一管理所有钱包
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| user_id | INTEGER | 用户ID，外键关联 users 表 |
| address | TEXT | 钱包地址，唯一 |
| device | TEXT | 来自哪个签名机设备地址 |
| path | TEXT | 推导路径 |
| chain_type | TEXT | 地址类型：evm、btc、solana |
| wallet_type | TEXT | 钱包类型：user(用户钱包)、hot(热钱包)、multisig(多签钱包)、cold(冷钱包)、vault(金库钱包) |
| is_active | INTEGER | 是否激活：0-未激活，1-激活 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### 钱包 Nonce 表 (wallet_nonces) - 管理钱包的 nonce
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| address | TEXT | 钱包地址（避免二次查询，直接使用地址而非wallet_id） |
| chain_id | INTEGER | 链ID |
| nonce | INTEGER | 当前 nonce 值，用于交易排序 |
| last_used_at | DATETIME | 最后使用时间 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**约束**:
- `UNIQUE(address, chain_id)` - 每个钱包在每个链上只有一个nonce记录

**索引**:
- `idx_wallet_nonces_address` - 钱包地址索引
- `idx_wallet_nonces_chain` - 链ID索引
- `idx_wallet_nonces_last_used` - 最后使用时间索引

### 已使用操作ID表 (used_operation_ids) - 防止重放攻击
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| operation_id | TEXT | 操作ID（UUID），唯一 |
| used_at | INTEGER | 使用时间戳（毫秒） |
| expires_at | INTEGER | 过期时间戳（毫秒） |
| created_at | DATETIME | 创建时间 |

**约束**:
- `UNIQUE(operation_id)` - 操作ID唯一约束

**索引**:
- `idx_operation_ids_id` - 操作ID索引，用于快速查找
- `idx_operation_ids_expires_at` - 过期时间索引，用于定期清理

**说明**：
- 用于 DB Gateway 服务，防止 API 重放攻击
- 每个操作ID（operation_id）只能使用一次，保证操作的幂等性
- 操作ID由客户端（如 wallet 服务）生成，通常使用 UUID v4
- 默认5分钟后过期（expires_at = used_at + 5 * 60 * 1000）
- 适用场景：敏感操作（创建钱包、更新 nonce、创建提现等）


### 区块表 (blocks)
区块和交易表，需要为每个链创建一个对应的表：


| 字段 | 类型 | 说明 |
|------|------|------|
| hash | TEXT | 主键，区块哈希 |
| parent_hash | TEXT | 父区块哈希 |
| number | TEXT | 区块号，大整数存储 |
| timestamp | INTEGER | 区块时间戳 |
| status | TEXT | 区块确认状态：confirmed、safe、finalized 被重组：orphaned|
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |


### 交易记录表 (transactions)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| block_hash | TEXT | 区块哈希 |
| block_no | INTEGER | 区块号 |
| tx_hash | TEXT | 交易哈希，唯一 |
| from_addr | TEXT |  发起地址 |
| to_addr | TEXT |  接收地址 |
| token_addr | TEXT |  Token 合约地址 |
| amount | TEXT | 交易金额（存储为字符串避免精度丢失） |
| type | TEXT | 交易类型 充值提现归集调度：deposit/withdraw/collect/rebalance |
| status | TEXT | 交易状态：confirmed/safe/finalized/failed |
| confirmation_count | INTEGER | 确认数（网络终结性模式下可选） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### 代币表 (tokens)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键  |
| chain_type | TEXT | 链类型：eth/btc/sol/polygon/bsc 等 |
| chain_id | INTEGER | 链ID：1(以太坊主网)/5(Goerli)/137(Polygon)/56(BSC) 等 |
| token_address | TEXT | 代币合约地址（原生代币为空）， 如果是Solana 则是 mint account  |
| token_symbol | TEXT | 代币符号：USDC/ETH/BTC/SOL 等 |
| token_name | TEXT | 代币全名：USD Coin/Ethereum/Bitcoin 等 |
| decimals | INTEGER | 代币精度（小数位数） |
| is_native | BOOLEAN | 是否为链原生代币（ETH/BTC/SOL等） |
| collect_amount | TEXT | 归集金额阈值，大整数存储 |
| withdraw_fee | TEXT | 提现手续费，最小单位存储，默认 '0' |
| min_withdraw_amount | TEXT | 最小提现金额，最小单位存储，默认 '0' |
| status | INTEGER | 代币状态：0-禁用，1-启用 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**多链代币索引**: `UNIQUE(chain_type, chain_id, token_address, token_symbol)`

### 提现记录表 (withdraws)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| user_id | INTEGER | 用户ID，外键关联 users 表 |
| operation_id | TEXT | 操作ID（UUID），唯一，用于关联风控记录 |
| from_address | TEXT | 热钱包地址（可为空，签名时填充） |
| to_address | TEXT | 提现目标地址 |
| token_id | INTEGER | 代币ID，外键关联 tokens 表 |
| amount | TEXT | 用户请求的提现金额，最小单位存储 |
| fee | TEXT | 交易所收取、提现手续费，最小单位存储，默认 '0' |
| chain_id | INTEGER | 链ID |
| chain_type | TEXT | 链类型：evm/btc/solana |
| status | TEXT | 提现状态（见下方状态流转） |
| tx_hash | TEXT | 交易哈希（签名后填充） |
| nonce | INTEGER | 交易 nonce（签名时填充） |
| gas_used | TEXT | 实际使用的 gas（确认后填充） |
| gas_price | TEXT | Gas 价格（Legacy 交易） |
| max_fee_per_gas | TEXT | 最大费用（EIP-1559 交易） |
| max_priority_fee_per_gas | TEXT | 优先费用（EIP-1559 交易） |
| error_message | TEXT | 错误信息（失败时填充） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**约束**:
- `UNIQUE(operation_id)` - 操作ID唯一约束，用于关联风控记录

**索引**:
- `idx_withdraws_user_id` - 用户ID索引
- `idx_withdraws_status` - 状态索引
- `idx_withdraws_created_at` - 创建时间索引
- `idx_withdraws_chain` - 链ID+链类型复合索引
- `idx_withdraws_tx_hash` - 交易哈希索引
- `idx_withdraws_operation_id` - 操作ID索引，用于关联查询

**状态流转**:
```
user_withdraw_request → risk_reviewing → signing → pending → processing → confirmed
         ↓                    ↓              ↓        ↓           ↓
       failed              rejected       failed   failed      failed
                               ↓
                         manual_reviewing → (审核通过) → signing
                               ↓
                          (审核拒绝) → rejected
```

**状态说明**:
- `user_withdraw_request`: 用户提交提现请求
- `risk_reviewing`: 风控评估中
- `manual_reviewing`: 需要人工审核（风控返回 manual_review）
- `signing`: 签名交易中
- `pending`: 交易已发送，等待确认
- `processing`: 交易确认中
- `confirmed`: 交易已确认
- `rejected`: 风控拒绝或人工审核拒绝
- `failed`: 签名或交易失败

**与风控系统的关联**:
- 通过 `operation_id` 字段关联 `risk_control.db` 的 `risk_assessments` 表
- 每个提现记录对应一条风控评估记录
- 人工审核通过后，根据 `operation_id` 查找 `withdraws` 记录并继续处理

### 资金流水表 (credits)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| user_id | INTEGER | 用户ID |
| address | TEXT | 钱包地址 |
| token_id | INTEGER | 代币ID，关联tokens表 |
| token_symbol | TEXT | 代币符号，冗余字段便于查询 |
| amount | TEXT | 金额，正数入账负数出账，以最小单位存储 |
| credit_type | TEXT | 流水类型：deposit/withdraw/collect/rebalance/trade_buy/trade_sell/freeze/unfreeze等 |
| business_type | TEXT | 业务类型：blockchain/spot_trade/internal_transfer/admin_adjust等 |
| reference_id | TEXT | 关联业务ID（如txHash_eventIndex、withdraw_id等） |
| reference_type | TEXT | 关联业务类型（如blockchain_tx、withdraw等） |
| chain_id | INTEGER | 链ID，可为空（支持历史数据） |
| chain_type | TEXT | 链类型，可为空（支持历史数据） |
| status | TEXT | 状态：pending/confirmed/finalized/failed |
| block_number | INTEGER | 区块号（链上交易才有） |
| tx_hash | TEXT | 交易哈希（链上交易才有） |
| event_index | INTEGER | 事件索引（区块链事件的logIndex） |
| metadata | TEXT | JSON格式的扩展信息 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**唯一性约束**: `UNIQUE(user_id, reference_id, reference_type, event_index)`

用户做现货交易、或者内部转账时，同样用 credits 表跟踪

### 提现流程说明

提现功能涉及以下表的协作：

1. **提现请求流程**：
   - 用户发起提现 → 创建 `withdraws` 记录（状态：`user_withdraw_request`）
   - 扣除用户余额 → 创建 `credits` 记录（`reference_type: 'withdraw'`）
   - 选择热钱包 → 更新 `withdraws` 记录（状态：`signing`）
   - 签名交易 → 更新 `withdraws` 记录（状态：`pending`，填充 `tx_hash`）
   - 确认交易 → 更新 `withdraws` 记录（状态：`confirmed`）

2. **费用计算**：
   - 用户请求金额：`withdraws.amount`
   - 提现手续费：`withdraws.fee`（来自 `tokens.withdraw_fee`）
   - 实际转账金额：`amount - fee`

3. **数据关联**：
   - `withdraws` 表记录提现的完整生命周期
   - `credits` 表通过 `reference_id` 和 `reference_type` 关联提现记录
   - 一条提现记录对应一条扣除的 credit 记录

### 余额聚合视图用户代币总余额 （[v_user_token_totals](./src/db/connection.ts)）


