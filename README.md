# CEX 钱包系统

交易所钱包系统，提供安全的钱包管理和地址生成服务。

系统设计和实现思路，参考以下文章：

1. [交易所钱包系统的整体架构设计](https://learnblockchain.cn/article/20345)
2. [签名机与用户账户生成的方案](https://learnblockchain.cn/article/20693) 
3. [用户充值](https://learnblockchain.cn/article/20925)
4. [用户提现](https://learnblockchain.cn/article/21061)
5. [风控设计](https://learnblockchain.cn/article/21233)


## 主要模块

- **wallet**: 主模块，提供钱包管理 API
- **signer**: 签名机，负责地址生成和密钥管理  
- **scan**: 区块链扫描器，支持智能重组处理和存款检测, 每一个链有独立的扫描模块
  - evm_scan: 扫描 EVM 链
  - solana_scan: 扫描 Solana 链
- **risk_control**: 风控模块
- **fund_rebalance**: 资金调度模块


## 文档

- [API 使用说明](API_USAGE.md)
- [Signer 模块文档](signer/README.md)
- [Wallet 模块文档](wallet/README.md)
- Scan 模块文档: [EVM 链](scan/evm_scan/README.md) 、  [Solana 链](scan/solana_scan/README.md)
- [风控 模块文档](risk_control/README.md)
- [数据库网关模块文档](db_gateway/README.md)

## 快速开始

1. 配置环境变量（参考各模块文档）
2. 启动数据库: cd db_gateway && npm run dev （自动创建数据库表）
  1. 生成密钥对: curl -X POST http://localhost:3003/generate-keypair
  2. 配置环境变量: 将公钥配置到数据库网关，私钥配置到 wallet/Scan/risk_control模块
3. 启动 risk_control 服务 (cd risk_control && npm run dev)
4. 启动 signer 服务（配置 .env 的助记词,  `./start_signer.sh` 使用默认密码启动 ）
5. 启动 wallet 服务  (cd wallet && npm run dev)
6. 模拟一些数据：
   1. 启动 以太坊 和 Solana 本地模拟网络： `./start_anvil.sh` 和 `./start_solana_localnet` 
   2. 执行 wallet 模块下的 Token 部署脚本：`npm run deploy:erc20:tokens` 和 `npm run deploy:solana:tokens`
   3. 执行 wallet 模块下的  `npm run mock:init` 填充一些测试的 ETH 及 Solana 用户地址。(注意本地测试，先部署 token )
7. 启动两个 scan 服务， 扫描存款入账
   1. EVM scan ： `cd scan/evm_scan && npm run dev`
   2. Solana scan: `cd scan/solana_scan && npm run dev`
   3. 执行 wallet 模块下 EVM 转账 ``
8.  执行 wallet 模块下的 requestWithdraw.ts 测试提款

服务推荐启动顺序：db_gateway -> risk_control -> signer  ->  wallet -> scan

## 贡献指南

欢迎你和我们一起完善代码，方便更多的人实现托管系统：

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 创建 Pull Request

## 许可证

MIT License
