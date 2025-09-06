# CEX 钱包系统

交易所钱包系统，提供安全的钱包管理和地址生成服务。

## 主要模块

- **wallet**: 主模块，提供钱包管理 API
- **signer**: 签名机，负责地址生成和密钥管理
- **scan**: 扫描充值服务
- **risk_control**: 风控模块
- **fund_rebalance**: 资金调度模块

## 快速开始

1. 配置环境变量（参考 `QUICK_START.md`）
2. 安装依赖：`npm install`
3. 启动服务：`./start-services.sh`

## 文档

- [快速开始指南](QUICK_START.md)
- [API 使用说明](API_USAGE.md)
- [集成说明](INTEGRATION_README.md)
- [Signer 模块文档](signer/README.md)
- [Wallet 模块文档](wallet/README.md)




