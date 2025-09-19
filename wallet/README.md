# CEX钱包系统 - 主模块

CEX钱包系统的主模块，提供钱包管理 API：
1. 为用户创建钱包（通过调用 Signer 模块生成钱包地址，并将钱包信息存储到数据库中。）
2. 获取用户的余额


[数据库设计](./database.md)
[API 接口说明](../API_USAGE.md)
 

## 技术栈

- **Node.js** - 运行时环境
- **TypeScript** - 类型安全的JavaScript超集
- **Express.js** - Web应用框架
- **SQLite3** - 轻量级数据库
- **Axios** - HTTP客户端（用于调用 Signer 模块）


## 安装依赖

```bash
npm install
```

## 环境配置

创建 `.env` 文件：
```bash
# Signer 模块基础 URL (必需)
SIGNER_BASE_URL=http://localhost:3001

# 服务端口 (可选，默认为 3000)
PORT=3000
```

⚠️ **重要**: 确保 Signer 模块已启动并运行在指定的 URL 上。

## 开发环境

### 启动开发服务器
```bash
npm run dev
```
服务器将在 `http://localhost:3000` 启动

### 监听模式（自动重启）
```bash
npm run dev:watch
```

## 生产环境

### 编译TypeScript
```bash
npm run build
```

### 启动生产服务器
```bash
npm start
```
 
## 启动服务器

在运行测试之前，需要先启动服务器：

```bash
# 开发模式启动服务器
npm run dev

# 或者生产模式启动
npm run build
npm start
```

#### 运行测试套件

```bash
# 运行所有测试
npm test

# 运行钱包API测试
npm run test:wallet

# 运行特定测试文件
npx ts-node tests/wallet.test.ts
```

### 手动测试

除了自动化测试，你也可以使用curl进行手动测试：

```bash
# 健康检查
curl http://localhost:3000/health

# 获取用户钱包地址
curl "http://localhost:3000/api/user/123/address?chain_type=evm"

# 获取用户余额总和（所有链）
curl http://localhost:3000/api/user/123/balance/total

# 获取用户充值中余额
curl http://localhost:3000/api/user/123/balance/pending

# 获取用户指定代币余额详情
curl http://localhost:3000/api/user/123/balance/token/USDT
```

