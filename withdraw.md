0x7e9b31ecfb1252a6f515b08de5fac21273ee8d12

获得支持的某个币种的支持网络

最低提现量

从哪个钱包转出

创建热钱包

热钱包 nonce 管理 

扣除手续费后， 多少
实际到账

离线签名

风控

查询用户提现记录
GET /user/:id/withdraws - 获取用户的提现历史
GET /user/:id/withdraws/:withdrawId - 获取特定提现记录详情



用户请求 → POST /user/withdraw
    ↓
创建提现记录（user_withdraw_request）
    ↓
选择热钱包，更新状态（signing）
    ↓
签名交易，更新状态（pending）
    ↓
[管理员监控] GET /withdraws/pending
    ↓
[管理员确认] PUT /withdraws/:id/status → confirmed
    ↓
用户查询 GET /user/:id/withdraws


2. 常见的收费模式

不同交易所的提现手续费计算方式会有差别，常见几种：

固定费用制

用户提现，无论链上实际成本多少，统一收取固定的手续费。

例子：0.0005 BTC / 笔。

优点：用户可预期，操作简单。

缺点：在网络拥堵时，手续费可能不足以覆盖成本；在网络空闲时，手续费偏高，交易所赚取差额。

动态费用制（跟随网络费浮动）

交易所根据链上实时费率计算提现费用，并加上少量溢价。

例子：用户提现 ETH 时，收取实际 gas + 10% buffer。

更接近真实成本，适合 gas 波动大的链。

分档费用制

提现额度较大时，按笔数或金额收不同档位的手续费。

例子：小额提现收固定费率，大额提现可以相对优惠。

免费或补贴制

部分交易所（尤其新交易所或 CEX 推广期）会补贴链上手续费，用户提现免手续费。

实际成本由交易所承担。

3. 链别差异

比特币（BTC）

手续费和交易大小（字节数）成正比，交易所一般收固定费率。

以太坊（ETH）及 EVM 链

费用 = Gas Used × Gas Price。

提现多为 ERC20 转账，Gas 用量比较固定（2–7万左右），但 Gas Price 波动大。

稳定币（USDT/USDC）多链情况

交易所会列出多个链（ERC20、TRC20、BEP20），手续费不同：

ERC20 较贵，通常 2–10 USDT。

TRC20 较便宜，常见 1 USDT 固定。

BEP20 更低，有时 0.5 USDT。

4. 实际计算例子

比如用户在交易所提现 100 USDT（ERC20）：

链上实际成本：GasUsed ≈ 50,000 × GasPrice（30 gwei）≈ 0.0015 ETH ≈ 4.5 USD。

交易所设定手续费：5 USDT 固定。

用户支付 5 USDT，交易所实际花 4.5 美元，赚取差额。

👉 综上，提现手续费本质上是“链上实际矿工费 + 交易所定价策略”。多数交易所会倾向于用 固定费率（简单且能稳定盈利），少数交易所用 动态费率（更公平但复杂）。


2. RPC / 节点查询时的 nonce

当你用 JSON-RPC 调用时，不同参数会影响结果：

eth_getTransactionCount(address, "latest")

返回账户在最新区块中的 nonce（只算已确认的交易）。

不包含 pending 交易。

eth_getTransactionCount(address, "pending")

返回已确认交易 + 当前节点内存池（mempool）里 待打包的交易数。

也就是说，这个值 = 链上 nonce + pending tx 数量。

这样可以让钱包或 dApp 正确给新交易分配 nonce，避免和未上链的交易冲突。

举例

假设某个地址：

已经有 3 笔交易打包（nonce = 0,1,2）

现在又发了 2 笔交易在 mempool，分别是 nonce = 3 和 nonce = 4，还没上链

那么：

eth_getTransactionCount(address, "latest") = 3

eth_getTransactionCount(address, "pending") = 5

✅ 总结：

链上真实存储的 nonce 不包含 pending。

但通过 RPC 查询 "pending" 可以得到一个“未来可能的 nonce”，包含 pending 交易。


// 建议：添加风控检查
- 单日提现限额
- 单笔提现限额
- 异常地址检测
- 频率限制
- 黑名单检查


// 建议：配置化
const config = {
  maxWithdrawAmount: process.env.MAX_WITHDRAW_AMOUNT,
  minWithdrawAmount: process.env.MIN_WITHDRAW_AMOUNT,
  withdrawFee: process.env.WITHDRAW_FEE,
  gasLimit: process.env.GAS_LIMIT
};