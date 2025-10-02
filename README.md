# CEX 钱包系统

交易所钱包系统，提供安全的钱包管理和地址生成服务。

系统设计和实现思路，参考以下文章：

1. [交易所钱包系统的整体架构设计](https://learnblockchain.cn/article/20345)
2. [签名机与用户账户生成的方案](https://learnblockchain.cn/article/20693) 
3. [用户充值](https://learnblockchain.cn/article/20925)
4. [用户提现](https://learnblockchain.cn/article/21061)


## 主要模块

- **wallet**: 主模块，提供钱包管理 API
- **signer**: 签名机，负责地址生成和密钥管理  
- **scan**: 区块链扫描器，支持智能重组处理和存款检测
- **risk_control**: 风控模块
- **fund_rebalance**: 资金调度模块


## 文档

- [API 使用说明](API_USAGE.md)
- [Signer 模块文档](signer/README.md)
- [Wallet 模块文档](wallet/README.md)
- [Scan 模块文档](scan/README.md)
- [风控 模块文档](risk_control/README.md)
- [数据库网关模块文档](db_gateway/README.md)

## 快速开始

1. 配置环境变量（参考各模块文档）
2. 启动数据库: cd db_gateway && npm run dev （自动创建数据库表）
  1. 生成密钥对: curl -X POST http://localhost:3003/generate-keypair
  2. 配置环境变量: 将公钥配置到数据库网关，私钥配置到Wallet/Scan/risk_control模块
3. 启动 risk_control 服务
4. 启动 wallet 服务
5. 启动 signer 服务（配置 .env 的助记词）
6. 执行 wallet 模块下的 mock.ts 填充一些测试数据。
7. 执行 scan 服务， 扫描存款入账
8. 执行 wallet 模块下的 requestWithdraw.ts 测试提款


## 贡献指南

欢迎你和我们一起完善代码，方便更多的人实现托管系统：

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 创建 Pull Request

## 许可证

MIT License
