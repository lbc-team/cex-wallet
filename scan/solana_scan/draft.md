
## 文章


1. 介绍 PDA 地址

问题： 
1. 记录用户 ATA 么？（rent 租金谁付 ）、 预先计算地址（如何保存）
2. 确认位： 32 ， 只在 finalized 

数据库： ClickHouse BigQuery 列式数据库（OLAP）： 批量写入快，单条写入慢， 聚合、扫描型读取极快

或 PostgreSQL  MySQL/PostgreSQL 按行存储数据，适合事务型访问（频繁增删改）。

写入列式数据库（例如 ClickHouse）用于高吞吐、低延迟的查询与按地址/参考查询历史。

把事务性数据写入 Postgres（账本层、幂等表）。


自己跑节点+索引器或使用专门的链上索引服务 indexer（如 Helius、QuickNode 的 Logs API、或自建索引器）会更稳定、延迟低、功能丰富。

每笔 txhash 幂等与去重 

比如用 Kafka 或 RabbitMQ ？

缓存 user 对应地址映射：把 address->userId cache 在 redis，减少 DB 查询。

数据库：ClickHouse 节点（列存）+ Postgres（事务）+ Redis（缓存）。


## 扫描Solana 的几个方法：

### 扫账号
1. 账号数量小： 扫账户状态变化来确定充值入账。
2. 中等账号数量： 扫描特定的 mint Account
3. 很多的 mint account： 扫描 program Account
4. 
5. 使用索性服务： 
Helius（支持 Reference Account 监听、Webhooks、SQL-like 过滤）
这种方式“监听入账”

一次监听多个地址： Web hook 回调


不能像类似以太坊
比较同一个 slot 的 blockhash 是否变化
✅ 有效检测 reorg

Solana 共识不依赖 blockhash 形成链结构

只信任 finalized 
 **Tower BFT 共识**，分叉选择由验证者投票决定

### 扫块

参考 @scan/evm_scan 模块， 实现 @scan/solana_scan 模块：
使用最新的 @solana/kit 库完成扫块
需要处理可能回滚的逻辑，
在 db_gateway 下，添加Solana 相应的表
连接接本地测试节点

主要流程伪代码：
```
    const slot = await waitForNextSlot(lastSlot + 1);
    const block = await rpc.getBlock(slot, { maxSupportedTransactionVersion: 0 }); // 或者从 validator 读取
    const parsedDeposits = parseBlock(block); // 展开 tx -> instructions 和innerinstructions 解析出 sol 和 spltoken spltoken 2022 的转账
    await writeDepositsToDB(parsedEvents);
    lastSlot = slot;
    setCursor("block_slot", lastSlot);
  }
```


 



监听新 block slot

扫账户状态：
```
getSignaturesForAddress(address, { before, until, limit })
getTransaction(signature, { maxSupportedTransactionVersion: 0 })
```

然后解析：
哪个 token program 被调用；
哪个账户收到了转账；
有无 memo；
金额和发送者；
最后判断是不是充值。

监听新 block slot， 或获取 getSlot

通过 getSignaturesForAddress / getConfirmedSignaturesForAddress2 获取与充值相关地址的交易签名。

第一次调用 getSignaturesForAddress  第一次调用时不要传 before 参数。
Solana 的交易历史是按 slot 从新到旧 排序的

「增量更新」（从旧到新）时，可以用 until。

“从最新的交易开始，按时间倒序排列的前 1000 条签名记录”。

获取交易详情

对每个签名调用 getTransaction(signature, { encoding: "jsonParsed" })。

遍历：

transaction.message.instructions

meta.innerInstructions

筛选 Token Program

如果 program == "spl-token" 且 parsed.type == "transfer" || "transferChecked"，再判断目标地址是不是交易所用户的收款账户。

入库匹配

以 destination 地址为索引匹配到内部账户，实现入账。

### 步骤：
#### 1. 永久化 ledger 与 Archive 节点
#### 2. 构建高性能的 Block → Event 转换器（自建 indexer）
RPC 对同一个地址的历史签名数量有限制（默认 ~1000 条）


实时流式消费： 从 RPC/validator 获取 block 数据（或从 gossip/ledger stream），并把每个 tx 的 instructions 展开成可查询的事件行。

解析重点：

native SOL transfers（system program）
SPL token transfers（token program logs / parsed instructions）

#### 4. 分片
分片（sharding）策略：把你要监控的用户地址集合按哈希或按分区（比如 256 个分片）划分，每个分片分配一组 worker 去拉 getSignaturesForAddress 或直接查询 indexer 的 “events table”。

分页/游标： 对每个地址使用 signature pagination（保存 lastSignatureProcessed）来做增量拉取，避免全表回溯。

批量查询： 对大量地址，避免一条条请求 RPC。应聚合请求（对 block/slot 做流式处理，然后在事件层做地址过滤）。



## 关于日志：
在 Solana 中：

每个交易（Transaction）执行时，会产生一系列 执行日志（program logs）。

这些日志包含：
1. 程序调用栈（Program invocation）
2. 自定义的日志输出（msg!()）
3. 系统或 runtime 生成的错误、事件
4. 在 Solana 中：

每个交易（Transaction）执行时，会产生一系列 执行日志（program logs）。
这些日志包含：
程序调用栈（Program invocation）
自定义的日志输出（msg!()）
系统或 runtime 生成的错误、事件

节点账本裁剪（ledger pruning），旧的 slot 数据、交易详细信息、日志会被删除。

总结： Solana 的链上「状态」是永久保存的（account state），但「交易执行日志」和「交易详情」并不永久存在。

solana-validator（或 RPC 节点），开启 --enable-cpi-and-log-storage


parsed.type == transfer / transferChecked

Geyser Plugin

https://api.helius.xyz/v0/addresses/<user_ata>/transactions


•获取块⾥⾯的交易，判断是 native token 或者是代币充值
◦ native token：主链币充值 program 等于 system 并且 type 为 transfer
◦ Token：代币充值 program 等于 spl-token 并且 type 为 transfer 或者 transferChecked。

从 ATA 地址映射到钱包充值