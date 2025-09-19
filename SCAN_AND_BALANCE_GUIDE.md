### 交易所区块扫描与入账全流程实战（scan 模块 × wallet API）

#### 1. 概述
- 目标：持续扫描区块识别入金（ETH 与 ERC20），在重组风险下安全推进确认，最终入账到用户余额，并提供统一的余额查询 API。
- 组成：
  - 扫描服务 scan：纯后台程序（无 HTTP），基于 viem，连接本地/远端 RPC；负责编排“扫描 → 识别 → 确认 → 入账 → 抗重组”。
  - 钱包服务 wallet：提供余额查询 API；首次启动自动创建表；统一格式化输出（小数点后 6 位）。
  - 数据库：SQLite（WAL 模式，busy_timeout）；表含 blocks、transactions、balances、tokens、wallets 等。

#### 2. 架构与核心流程
1) 启动：从 START_BLOCK 或数据库中最后“confirmed”的区块号开始。
2) 初始同步：按批 SCAN_BATCH_SIZE 扫描至最新高度；追上后转为按 SCAN_INTERVAL 定时轮询。
3) 区块处理：下载区块 → 调用交易分析器识别入金（ETH 或 ERC20 Transfer）→ 以默认状态“confirmed”保存交易。
4) 确认推进：随新区块累计确认数（confirmation_count）。
   - confirmed → safe（达到基础确认数，如 32）
   - safe → finalized（达到最终确认标准）
5) 入账：仅在 finalized 时，将金额累加到 balances（移除 pending_balance，降低重组复杂度）。
6) 抗重组：父哈希连续性校验→ 分叉检测与共同祖先回溯 → 回滚“受影响区块的交易”并标记孤块 → 自祖先+1重扫正确链。

> 关键设计：只有 finalized 才入账；reorg 时不会回滚“尚未最终确认”的余额，安全稳健。

#### 3. 区块处理细化：ETH 与 Token 的入账

##### 3.1 统一前置逻辑
- 链信息：运行时 `getChainId()`，只加载该链代币（`tokens.chain_id = 当前链`）。
- 原生代币：通过 `is_native=1` 识别（不再硬编码 'ETH'）。
- 地址/合约匹配：钱包地址、合约地址一律大小写不敏感（`LOWER(addr)`）。
- 交易入库初始：发现入金即写 `transactions`，`status='confirmed'`，`confirmation_count=0`。
- 金额换算：内部以“最小单位整数”记账；展示/API 统一按 `10^decimals` 标准化，并格式化为 6 位小数字符串。

##### 3.2 ETH 入账（原生代币）
1) 识别条件：`tx.to` 命中用户地址 且 `tx.value > 0`。
2) 数据获取：`WalletDAO.getWalletByAddress(tx.to)`；`TokenDAO.getNativeToken(chainId)`（如 ETH，`decimals=18`）。
3) 交易入库：`type='deposit'`，`status='confirmed'`，保存标准化后金额（API 层统一 6 位小数）。
4) 确认推进：`confirmed → safe → finalized`。
5) 最终入账：在 `finalized` 时，将最小单位金额累加进 `balances.balance`，并将交易置为 `finalized`。
6) 注意：仅处理“直接转账到地址”的 ETH；合约内部转账如需支持，另行扩展 trace/事件逻辑。

##### 3.3 ERC20 入账（Token）
1) 识别条件：解析 receipt 日志中 `Transfer(address,address,uint256)`，`to` 命中用户地址；`token_address` 属于当前链配置。
2) 数据获取：`TokenDAO.getTokenByAddress(tokenAddress, chainId)`，读取 `decimals`；注意 `to` 可能为 null，需要判空。
3) 交易入库：`type='deposit'`，`status='confirmed'`，保存标准化金额（由 `value / 10^decimals` 得出）。
4) 确认推进：`confirmed → safe → finalized`。
5) 最终入账：在 `finalized` 时，以最小单位整数更新 `balances`，并将交易置为 `finalized`。
6) 注意：同一 `token_symbol` 可跨链存在（如 USDT 在 ETH/BSC/Polygon）；仅加载当前 `chain_id` 的配置避免误判。

#### 4. 重组（Reorg）处理策略
- 连续性校验：对比本地区块与链上区块的 parentHash；不连续则可能重组。
- 分叉检测：回溯寻找共同祖先（common ancestor）。
- 回滚到祖先：对“受影响区块”删除交易记录、回滚影响，并将对应 `blocks.status='orphaned'`（保留审计）。
- 重新同步：自祖先+1 重新处理正确链区块。
- 业务查询：一律按 `status != 'orphaned'` 过滤孤块，避免误用。

#### 5. 数据库与表的关键要点
- **tokens**：`chain_type`、`chain_id`、`token_symbol`、`token_name`、`token_address?`、`decimals`、`is_native`、`collect_amount`、`status`。
- **credits**：`user_id`、`address`、`token_id(FK)`、`amount`（最小单位字符串）、`credit_type`、`business_type`、`reference_id`（txHash_logIndex）、`status`、`event_index`（真实logIndex）等。
- **transactions**：`tx_hash(唯一)`、`from_addr`、`to_addr`、`token_addr?`、`amount`（最小单位字符串）、`type`、`status`（confirmed/safe/finalized）、`confirmation_count` 等。
- **视图**：`v_user_balances`（按地址）、`v_user_token_totals`（跨地址聚合）、`v_user_balance_stats`（统计）。
- **缓存**：`user_balance_cache`（高频查询优化）。
- 规范：
  - 基于事件溯源，所有余额变更记录为Credit流水；
  - 完美幂等性，通过 `reference_id` 防重复处理；
  - 仅 finalized 状态的Credit计入余额；
  - 地址大小写不敏感查询；
  - SQLite 以读写+创建模式打开，启用 WAL 与 `busy_timeout=30000`。

#### 6. wallet 余额 API（统一 decimals 处理与 6 位小数格式化）
所有金额字段以字符串返回，精确到小数点后 6 位（如 "10.123456"），并在详情接口同时保留原始大整数与 decimals。

1) 获取"用户余额总和"（基于Credits流水聚合）
- 路由：`GET /api/user/{user_id}/balance/total`
- 说明：从Credits流水表聚合计算，支持可用余额和冻结余额分别显示。
- 响应示例：
```json
{
  "message": "获取用户余额总和成功",
  "data": [
    { 
      "token_symbol": "USDT", 
      "total_balance": "3.500000",
      "available_balance": "3.000000",
      "frozen_balance": "0.500000",
      "address_count": 2 
    },
    { 
      "token_symbol": "ETH",  
      "total_balance": "2.000000",
      "available_balance": "2.000000", 
      "frozen_balance": "0.000000",
      "address_count": 1 
    }
  ]
}
```

2) 获取“用户充值中余额”（从交易表查询 confirmed/safe 存款）
- 路由：`GET /api/user/{user_id}/balance/pending`
- 说明：按代币聚合，金额按 decimals 标准化并格式化。
- 响应示例：
```json
{
  "message": "获取充值中余额成功",
  "data": [
    { "token_symbol": "ETH",  "pending_amount": "0.500000",  "transaction_count": 2 },
    { "token_symbol": "USDT", "pending_amount": "100.000000", "transaction_count": 1 }
  ]
}
```

3) 获取“用户指定代币的跨链余额详情”
- 路由：`GET /api/user/{user_id}/balance/token/{token_symbol}`
- 说明：展示该代币在不同链上的余额分布与总和，金额标准化并格式化；同时返回原始值与 decimals。
- 响应示例：
```json
{
  "message": "获取USDT余额详情成功",
  "data": {
    "token_symbol": "USDT",
    "total_normalized_balance": "3.500000",
    "chain_count": 3,
    "chain_details": [
      { "chain_type": "bsc",     "token_id": 7,  "balance": "2000000000000000000", "decimals": 18, "normalized_balance": "2.000000" },
      { "chain_type": "eth",     "token_id": 8,  "balance": "1000000",             "decimals": 6,  "normalized_balance": "1.000000" },
      { "chain_type": "polygon", "token_id": 10, "balance": "500000",              "decimals": 6,  "normalized_balance": "0.500000" }
    ]
  }
}
```

#### 7. 配置建议与运行参数
- viem：`ETH_RPC_URL=http://127.0.0.1:8545`（本地测试）
- 扫描参数（示例）：
  - `START_BLOCK`：初次扫描起点
  - `CONFIRMATION_BLOCKS=32`，`SCAN_BATCH_SIZE=10`，`SCAN_INTERVAL=12`，`REORG_CHECK_DEPTH=64`
- 确认机制（支持两种模式）：
  - **确认数模式**（默认）：`USE_NETWORK_FINALITY=false`，safe=CONFIRMATION_BLOCKS/2，finalized=CONFIRMATION_BLOCKS
  - **网络终结性模式**（可选）：`USE_NETWORK_FINALITY=true`，基于网络safe/finalized标记
- wallet 启动自动建表；scan 为纯后台任务，随服务启动运行。

#### 8. 常见坑与最佳实践
- 仅在 finalized 入账（安全性与一致性优先）。
- 查询 blocks 时过滤孤块（`status != 'orphaned'`）。
- 仅加载当前链代币（按 chainId）；原生代币用 `is_native` 判断。
- 地址与合约大小写不敏感；代币未配置时严禁入账并记录错误。
- SQLite：WAL + `busy_timeout`；避免长事务与读写锁竞争。
- 金额存储与展示分离：内部最小单位整数，外部统一标准化与 6 位小数格式化。
- 确认机制选择：生产环境建议先使用确认数模式，测试验证后可启用网络终结性模式。
- `confirmation_count` 字段：网络终结性模式下可选，但保留用于兼容性和调试。

#### 9. 结语
本方案将“扫描、确认、重组恢复、最终入账”闭环与“多链余额统一查询”无缝衔接：
- 安全：重组期间不会污染余额；最终一致性明确。
- 可审计：孤块保留、详情接口保留原始值与 decimals。
- 多链友好：按 chainId 管理代币与余额，API 统一格式返回。
- 易扩展：可继续接入更多链/代币、完善内转解析、增加指标监控。
