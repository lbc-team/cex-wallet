
[] ETH 入账不支持合约内部转账（internal value transfer）。
方案：可选集成 trace（如 debug_traceBlock） 
 
[] API 访问安全, 做鉴权

[] 多链扩展: BTC Solana

[] 归集 /风控（黑名单、异常地址）未接入

[ ] 热钱包的余额管理， 没有考虑到 fee， 应该在 scan 中确认提现交易后，扣出手续费

[] 大规模并发提现时，使用 EIP7702 钱包批量提现

 
 

