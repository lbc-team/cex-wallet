# CEX 钱包系统

交易所钱包系统，提供安全的钱包管理和地址生成服务。

## 主要模块

- **wallet**: 主模块，提供钱包管理 API
- **signer**: 签名机，负责地址生成和密钥管理  
- **scan**: 区块链扫描器，支持智能重组处理和存款检测
- **risk_control**: 风控模块
- **fund_rebalance**: 资金调度模块

## 快速开始

1. 配置环境变量（参考 `QUICK_START.md`）
2. 安装依赖：`npm install`
3. 启动 wallet 服务（自动创建数据库表）
4. 启动 scan 服务（区块链扫描器）

## 文档

- [快速开始指南](QUICK_START.md)
- [API 使用说明](API_USAGE.md)
- [Signer 模块文档](signer/README.md)
- [Wallet 模块文档](wallet/README.md)
- [Scan 模块文档](scan/README.md)




