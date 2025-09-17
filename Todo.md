确认/终结判定不够“链原生”
建议：以太坊使用 viem 的 safe/finalized block tag（而非纯高度阈值）判定 confirmed/safe/finalized，更贴近实际终结语义。
金额存储精度风险
现 transactions.amount 为 REAL，易有精度丢失。
建议：统一存“最小单位整数”（TEXT/INTEGER），展示层再按 decimals 格式化（已做）；保留或移除 REAL，避免混用。
ETH 入账范围偏窄
目前仅识别“直转地址”的 ETH 入账，忽略合约内部转账（internal value transfer）。
建议：可选集成 trace（如 debug_traceBlock）或事件型补充，以覆盖内部转账场景。
Token 覆盖与鲁棒性
仅基于标准 Transfer 事件，未覆盖 fee-on-transfer、代理合约异常日志等边缘情形。
建议：增加合约探测与失败回退日志、异常事件告警；对找不到 token 配置的交易做队列重试+告警。
重组数据“留存”与“治理”
孤块标记保留利于审计，但长期不清理会膨胀。
建议：加“保留策略”（如 N 天后清理）、后台定期任务；统计 totalReorgs 独立持久化。
入账幂等与对账能力
finalize 后入账依赖状态防重，但缺少“入账流水（ledger）”便于对账与回溯。
建议：新增 credits 明细表（唯一键：tx_hash+event_index），余额=聚合流水，彻底幂等、可回播。
观测性与弹性
目前仅日志，缺指标/告警与退避策略。
建议：增加 Prometheus 指标（滞后高度、TPS、reorg 次数、orphaned 数、DB 阻塞率）、RPC 失败退避与切换、批处理并发上限自适应。
API 访问安全
wallet API 未鉴权，适合内网/开发环境，不适合直接对外。
建议：接入认证/授权（服务间 token、IP 白名单、网关），做频率限制与审计日志。
扫描性能优化空间
逐 tx 获取回执/日志，RPC 往返多。
建议：批量获取（区块级日志筛选）、并发上限自适应、地址集/布隆过滤优化匹配。
Token 查询接口一致性
DAO 已将 getTokensByChain/getNativeToken 简化为只用 chainId，但 getTokenByAddress 仍带 chainType 参数。
建议：统一以 chainId 为主键维度，减少歧义。
多链扩展准备
设计已支持多链，但仅实现 EVM；Solana 未落地。
建议：抽象扫描器接口，按链类型实现适配器（EVM/Solana），复用统一入账与重组处理框架。
归集/风控未接入
collect_amount 等字段未实装归集；风控（黑名单、异常地址）未接。
建议：补齐归集服务与风控策略、阈值告警。
返回格式统一策略
统一 6 位小数利于一致性，但部分资产（如 8/12/18 小数）可能需更细粒度展示。
建议：对外 API 默认 6 位，支持 precision 可选参数（向下兼容）。
这些优化分为“安全一致性”（终结判定、幂等、鉴权、重组治理），“可观测与弹性”（指标、退避、清理），“覆盖面与性能”（internal transfer、批处理）三大类。优先级建议：终结判定与幂等流水 > API 鉴权 > 指标与重组清理 > 性能优化与多链扩展。