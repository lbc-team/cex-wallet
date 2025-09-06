# CEX 钱包系统快速开始指南

## 概述

本系统已成功集成了 wallet 模块和 signer 模块，实现了以下功能：

1. **Signer 模块**：负责从环境变量加载 MNEMONIC，生成钱包地址
2. **Wallet 模块**：向 Signer 模块发起请求，将生成的钱包信息写入数据库
3. **地址管理**：支持 EVM 类型，自动递增派生路径生成不同地址
4. **职责分离**：wallet 模块不再有生成钱包的功能，所有钱包生成都由 signer 模块负责

## 系统架构

```
┌─────────────────┐    HTTP请求    ┌─────────────────┐
│   Wallet 模块   │ ────────────► │   Signer 模块   │
│   (端口 3000)   │               │   (端口 3001)   │
│                 │               │                 │
│ - 接收用户请求  │               │ - 加载 MNEMONIC │
│ - 调用 Signer   │               │ - 生成地址      │
│ - 写入数据库    │               │ - 记录路径      │
└─────────────────┘               └─────────────────┘
```

## 1. 环境配置

### Signer 模块配置
创建 `signer/.env` 文件：
```bash
# 助记词 (必需) - 请替换为您的实际助记词
MNEMONIC=abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about

# 设备名称 (可选，默认为 signer_device1)
SIGNER_DEVICE=signer_device1

# 服务端口 (可选，默认为 3001)
PORT=3001
```

### Wallet 模块配置
创建 `wallet/.env` 文件：
```bash
# Signer 模块基础 URL (必需)
SIGNER_BASE_URL=http://localhost:3001

# 服务端口 (可选，默认为 3000)
PORT=3000
```

## 2. 安装依赖

```bash
# 安装 Signer 模块依赖
cd signer
npm install

# 安装 Wallet 模块依赖
cd ../wallet
npm install
```

## 3. 启动服务

```bash
# 启动 Signer 模块
cd signer
npm run dev &

# 启动 Wallet 模块
cd ../wallet
npm run dev &
```

## 4. 测试系统

### 健康检查
```bash
# 检查 Signer 模块
curl http://localhost:3001/

# 检查 Wallet 模块
curl http://localhost:3000/health
```

### 获取用户钱包地址
```bash
# 获取用户钱包地址（如果用户没有钱包，会自动创建）
curl "http://localhost:3000/api/user/123/address?chain_type=evm"
```

响应示例：
```json
{
  "message": "获取用户钱包成功",
  "data": {
    "id": 1,
    "user_id": 123,
    "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "chain_type": "evm",
    "path": "m/44'/60'/0'/0/0",
    "created_at": "2025-09-06 14:07:05",
    "updated_at": "2025-09-06 14:07:05"
  }
}
```

## 主要功能

### Signer 模块功能

1. **环境变量配置**：从 `MNEMONIC` 环境变量加载助记词，从 `SIGNER_DEVICE` 环境变量获取设备名
2. **地址生成**：根据链类型（目前支持 EVM）生成钱包地址
3. **路径管理**：自动递增派生路径的最后一位（如：m/44'/60'/0'/0/0 → m/44'/60'/0'/0/1）
4. **配置持久化**：使用 SQLite 数据库 (`signer-config.db`) 持久化当前索引和生成的地址信息

### Wallet 模块功能

1. **服务调用**：向 Signer 模块发起 HTTP 请求创建钱包
2. **数据存储**：将 Signer 返回的钱包信息写入 wallets 表
3. **健康检查**：检查 Signer 模块是否可用
4. **错误处理**：完整的错误处理和用户友好的错误信息
5. **职责分离**：不再包含任何钱包生成逻辑，专注于数据管理和 API 提供

## API 接口

### Signer 模块 API

- `POST /api/signer/create` - 创建新钱包
- `GET /` - 系统状态

### Wallet 模块 API

- `GET /api/user/{user_id}/address?chain_type=evm` - 获取用户钱包地址
- `GET /api/wallet/{wallet_id}/balance` - 获取钱包余额
- `PUT /api/wallet/{wallet_id}/balance` - 更新钱包余额
- `GET /health` - 健康检查

## 数据流程

1. **用户请求**：向 Wallet 模块发送获取钱包地址请求
2. **检查现有钱包**：Wallet 模块检查用户是否已有钱包
3. **调用 Signer**：如果用户没有钱包，Wallet 模块调用 Signer 模块生成新地址
4. **路径递增**：Signer 模块自动递增派生路径
5. **数据存储**：Wallet 模块将地址信息写入数据库
6. **响应返回**：返回钱包信息给用户

## 测试

### 运行模块测试

```bash
# 测试 Signer 模块
cd signer
npm test

# 测试 Wallet 模块
cd wallet
npm test
```

### 手动测试示例

```bash
# 创建测试用户
sqlite3 wallet/wallet.db "INSERT INTO users (username, email, password_hash, status, kyc_status) VALUES ('testuser', 'test@example.com', 'hashed_password', 0, 0);"

# 获取用户钱包地址
curl "http://localhost:3000/api/user/1/address?chain_type=evm"

# 验证数据库中的钱包记录
sqlite3 wallet/wallet.db "SELECT * FROM wallets;"
```

## 重要说明

- 请确保在 `signer/.env` 中设置正确的助记词
- 系统会自动创建 SQLite 数据库文件
- 首次运行时会自动初始化数据库表结构
- 请勿删除 `signer-config.db` 文件，以免丢失地址索引信息
- Wallet 模块依赖 Signer 模块，需要先启动 Signer 模块
- 系统会自动检查地址是否已存在，避免重复
- 完整的错误处理机制，包括网络错误和服务不可用

## 扩展性

- 支持添加新的链类型（BTC、Solana）
- 支持自定义设备名称
- 支持批量创建钱包
- 支持地址导入和导出功能