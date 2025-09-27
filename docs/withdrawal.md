### 提现功能设计与实现

本文梳理交易所钱包系统中的提现功能，从架构、数据模型、状态推进、风控安全到运维与常见问题，并提供一张流程图帮助理解整体链路。

## 概述

- 提现本质：在链上为用户发起转账，并在本地总账中准确反映余额扣减，经历 pending → confirmed → finalized 全生命周期。
- 关键口径：
  - 存款（deposit）仅在 finalized 后计入余额；
  - 取款（withdraw）在 confirmed 即计入扣减，finalized 进入最终状态；
  - 冻结（freeze）通常仅统计 finalized。

## 架构与职责

- 提现服务（Withdrawal Service）：接收请求、组装交易、选择热钱包、估算 gas、调用签名机签名并广播。
- 签名机（Signer）：私钥隔离，独立进程；启动参数传入口令（例如 `--password`），不经由请求体透传。
- 提现监控（WithdrawMonitor）：轮询链上交易收据与区块终结性，推进状态：pending → confirmed → finalized；失败回滚。
- 风控（Risk Control）：前置校验目的地址、额度与频次策略；高风险场景阻断签名/广播。
- 配置中心（scan/config）：`confirmationBlocks`、`scanInterval`、`useNetworkFinality` 等统一配置并被复用。

## 数据模型与余额口径

- 表：
  - `withdraws`：提现请求、链 ID、`tx_hash`、状态、`gas_used`、错误信息等。
  - `credits`：总账明细（正数增加、负数扣减），`credit_type`（deposit/withdraw/freeze 等），`status`（pending/confirmed/finalized/failed）。
  - `transactions`：链上交易归档，便于统一追踪与重放。
- 视图（示意，仅表达口径）：

```sql
-- 存款仅统计 finalized；取款统计 confirmed + finalized；冻结统计 finalized
SUM(CASE
  WHEN credit_type NOT IN ('freeze') AND (
    (credit_type = 'deposit'  AND status = 'finalized') OR
    (credit_type = 'withdraw' AND status IN ('confirmed','finalized'))
  ) THEN CAST(amount AS REAL)
  ELSE 0
END) AS available_balance
```

## 状态推进与终结性

1) 创建请求：写入 `withdraws(status=pending)`，在 `credits` 写入负数明细 `status=pending` 以锁定额度来源。
2) 签名与广播：选择热钱包、估算 gas，调用签名机签名并广播，写回 `tx_hash`。
3) 确认（confirmed）：收到成功收据后，`withdraws→confirmed`、对应 `credits→confirmed`、写入 `transactions`。
4) 终结（finalized）：
   - 优先使用网络终结性 `finalized`/`safe` block（`viemClient.getFinalizedBlock()`）；
   - 不可用时回落为确认块差 `latestBlock - txBlock ≥ confirmationBlocks`；
   - 达标后 `withdraws→finalized`、`credits→finalized`。
5) 失败：`withdraws→failed`，将对应的负数 `credits` 更新为 `failed`（不新增“退款”正数，避免账目分叉）。

## 提现流程图（Mermaid）

```mermaid
flowchart TD
  A[用户发起提现请求] --> B{风控校验\n额度/黑白名单/频次}
  B -- 拒绝 --> BX[返回失败]
  B -- 通过 --> C[选择热钱包\n估算 gas]
  C --> D[签名机签名\n广播交易]
  D --> E[记录 withdraws=pending\ncredits(pending, 负数)]
  E --> F{监控收据\ngetTransactionReceipt}
  F -- 未找到/重试 --> F
  F -- 失败 --> F1[withdraws=failed\ncredits=failed]
  F -- 成功 --> G[withdraws=confirmed\ncredits=confirmed\n记录 transactions]
  G --> H{终结性判断\n优先 finalized 块\n回退确认块差}
  H -- 达标 --> I[withdraws=finalized\ncredits=finalized]
  H -- 未达标 --> G
```

## 关键实现要点

- 统一客户端：在监控中复用 `viemClient`，避免重复创建 RPC 客户端并统一网络终结性逻辑。
- 链 ID 支持：本地链（31337）等开发网络需显式支持。
- 幂等与一致性：
  - 幂等键：`withdraws.id` + `tx_hash`；
  - `INSERT OR IGNORE` + 受限范围的 `UPDATE`，避免重复账目；
  - 失败重试必须可重复且无副作用。
- 配置复用：`scanInterval` 用于监控轮询间隔；`confirmationBlocks` 控制终结性；`useNetworkFinality` 可按网络能力开启。
- 日志与告警：
  - 关键状态变更必须落日志；
  - 长时间 pending/confirmed 未推进、失败峰值、RPC 异常应触发告警。

## 常见问题

- API 余额未变化：核对 `credits` 与视图口径（是否误含 pending、是否漏含 withdraw 的 confirmed）。
- 卡在 pending：确认签名/广播成功、RPC 可用、链 ID 与节点一致。
- confirmed 不进入 finalized：检查网络是否支持 `finalized`，否则核对确认块差与配置阈值。
- 失败后余额未恢复：确认将原负数 `credits` 标记为 `failed`，而不是新增正数“退款”。

## 参考资料

- 交易所钱包系统开发 #1 — 系统设计：`https://learnblockchain.cn/article/20345`
- 交易所钱包系统开发 #2 — 签名机设计与账户生成实现：`https://learnblockchain.cn/article/20693`
- 交易所钱包系统开发 #3 — 风控与合规实践：`https://learnblockchain.cn/article/20925`


