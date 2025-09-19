# CEX 钱包系统

交易所钱包系统，提供安全的钱包管理和地址生成服务。

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

## 快速开始

1. 配置环境变量（参考各模块文档）
2. 启动 wallet 服务（自动创建数据库表）
3. 启动 signer 服务（为使用生成一些地址， 配置 .env 的助记词）
4. 执行 wallet 模块下的 mock.ts 填充一些测试数据。
5. 执行 scan 服务， 扫描存款入账


## 贡献指南

欢迎你和我们一起完善代码，方便更多的人实现托管系统：

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 创建 Pull Request

## 许可证

MIT License
