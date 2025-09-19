## 数据库结构


## 数据库设计

wallet 服务启动时会自动检查并创建所需的数据库表，包括：
- `users` - 用户表
- `wallets` - 钱包表  
- `transactions` - 交易表（scan 服务使用）
- `tokens` - 代币表（scan 服务使用）
- `credits` - 资金流水表
- `blocks` - 区块表（scan 服务使用）

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
| status | INTEGER | 用户状态：0-正常，1-禁用，2-待审核 |
| kyc_status | INTEGER | KYC状态：0-未认证，1-待审核，2-已认证，3-认证失败 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |
| last_login_at | DATETIME | 最后登录时间 |

### 钱包表 (wallets)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| user_id | INTEGER | 用户ID，唯一，外键关联 users 表 |
| address | TEXT | 钱包地址，唯一 |
| device | TEXT | 来自哪个签名机设备地址 |
| path | TEXT | 推导路径 |
| chain_type | TEXT | 地址类型：evm、btc、solana |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |


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
| token_address | TEXT | 代币合约地址（原生代币为空） |
| token_symbol | TEXT | 代币符号：USDC/ETH/BTC/SOL 等 |
| token_name | TEXT | 代币全名：USD Coin/Ethereum/Bitcoin 等 |
| decimals | INTEGER | 代币精度（小数位数） |
| is_native | BOOLEAN | 是否为链原生代币（ETH/BTC/SOL等） |
| collect_amount | TEXT | 归集金额阈值，大整数存储 |
| status | INTEGER | 代币状态：0-禁用，1-启用 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**多链代币索引**: `UNIQUE(chain_type, chain_id, token_address, token_symbol)`


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
| reference_id | TEXT | 关联业务ID（如txHash_eventIndex） |
| reference_type | TEXT | 关联业务类型（如blockchain_tx） |
| status | TEXT | 状态：pending/confirmed/finalized/failed |
| block_number | INTEGER | 区块号（链上交易才有） |
| tx_hash | TEXT | 交易哈希（链上交易才有） |
| event_index | INTEGER | 事件索引（区块链事件的logIndex） |
| metadata | TEXT | JSON格式的扩展信息 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**唯一性约束**: `UNIQUE(reference_id, reference_type, event_index)`

用户做现货交易、或者内部转账时，同样用 credits 表跟踪

### 余额聚合视图

#### v_user_balances（按地址分组的用户余额）
```sql
SELECT 
  user_id, address, token_id, token_symbol, decimals,
  available_balance, frozen_balance, total_balance,
  available_balance_formatted, frozen_balance_formatted, total_balance_formatted
FROM credits c JOIN tokens t ON c.token_id = t.id
GROUP BY user_id, address, token_id
```

#### v_user_token_totals（用户代币总余额）
```sql
SELECT 
  user_id, token_id, token_symbol,
  total_available_balance, total_frozen_balance, total_balance,
  total_available_formatted, total_frozen_formatted, total_balance_formatted,
  address_count
FROM credits c JOIN tokens t ON c.token_id = t.id
GROUP BY user_id, token_id
```


### 余额缓存表 (user_balance_cache)
| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | INTEGER | 用户ID（复合主键） |
| token_id | INTEGER | 代币ID（复合主键） |
| token_symbol | TEXT | 代币符号 |
| available_balance | TEXT | 可用余额，最小单位存储 |
| frozen_balance | TEXT | 冻结余额，最小单位存储 |
| total_balance | TEXT | 总余额，最小单位存储 |
| last_credit_id | INTEGER | 最后处理的credit记录ID |
| updated_at | DATETIME | 缓存更新时间 |

**主键**: `PRIMARY KEY(user_id, token_id)`
