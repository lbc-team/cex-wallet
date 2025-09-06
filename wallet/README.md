# CEX钱包系统 - 主模块

这是CEX钱包系统的主模块，提供钱包管理API，通过调用 Signer 模块生成钱包地址，并将钱包信息存储到数据库中。

## 功能特性

- 💼 用户钱包管理：为每个用户生成唯一的钱包地址
- 🔗 Signer 模块集成：通过 HTTP 调用 Signer 模块创建钱包
- 💾 数据持久化：将钱包信息存储到 SQLite 数据库
- 🔄 智能获取：如果用户已有钱包则直接返回，否则创建新钱包
- 🛡️ 安全设计：API 响应中不包含私钥等敏感信息

## 使用场景

- **交易所钱包管理**: 为交易所用户生成和管理钱包地址
- **多用户支持**: 支持多个用户，每个用户拥有独立的钱包
- **多链支持**: 支持 EVM、Bitcoin、Solana 等多种区块链
- **地址隔离**: 每个用户使用不同的派生路径，确保地址唯一性

## 技术栈

- **Node.js** - 运行时环境
- **TypeScript** - 类型安全的JavaScript超集
- **Express.js** - Web应用框架
- **SQLite3** - 轻量级数据库
- **Axios** - HTTP客户端（用于调用 Signer 模块）
- **dotenv** - 环境变量管理

## 项目结构

```
wallet/
├── src/
│   ├── db/               # 数据库层
│   │   ├── connection.ts
│   │   ├── index.ts
│   │   └── models/       # 数据模型
│   │       ├── user.ts
│   │       ├── wallet.ts
│   │       ├── balance.ts
│   │       └── transaction.ts
│   ├── services/         # 业务逻辑层
│   │   ├── walletBusinessService.ts
│   │   └── signerService.ts
│   ├── routes/           # 路由层
│   │   └── wallet.ts
│   └── index.ts          # 主服务器文件
├── tests/                # 测试文件
│   ├── wallet.test.ts
│   ├── test-utils.ts
│   ├── test-integration.ts
│   └── run-tests.ts
├── dist/                 # TypeScript编译输出
├── tsconfig.json         # TypeScript配置
├── package.json          # 项目配置和依赖
├── env.example           # 环境变量示例
└── README.md            # 项目说明文档
```

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

### 清理编译文件
```bash
npm run clean
```

## API接口

### 基础信息
- **基础URL**: `http://localhost:3000`
- **数据格式**: JSON

### 接口列表

#### 1. 系统状态
```http
GET /
```
**响应示例**:
```json
{
  "message": "CEX钱包系统 - 主模块",
  "data": {
    "version": "1.0.0",
    "status": "running"
  }
}
```

#### 2. 健康检查
```http
GET /health
```
**响应示例**:
```json
{
  "message": "服务健康",
  "data": {
    "timestamp": "2025-01-01T00:00:00.000Z",
    "uptime": 123.45,
    "memory": {...}
  }
}
```

#### 3. 获取用户钱包地址
```http
GET /api/user/{user_id}/address?chain_type=evm
```
**请求参数**:
- `user_id` (路径参数): 用户ID
- `chain_type` (查询参数): 链类型，支持 `evm`、`btc`、`solana`

**响应示例**:
```json
{
  "message": "获取用户钱包成功",
  "data": {
    "id": 1,
    "user_id": 123,
    "address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
    "path": "m/44'/60'/0'/0/0",
    "chain_type": "evm",
    "created_at": "2025-01-01T00:00:00.000Z",
    "updated_at": "2025-01-01T00:00:00.000Z"
  }
}
```

**错误响应**:
```json
{
  "error": "错误信息"
}
```

#### 4. 获取钱包余额
```http
GET /api/wallet/{wallet_id}/balance
```
**响应示例**:
```json
{
  "data": {
    "balance": 100.5
  }
}
```

#### 5. 更新钱包余额
```http
PUT /api/wallet/{wallet_id}/balance
Content-Type: application/json

{
  "balance": 150.0
}
```


## 数据库结构

### 用户表 (users)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| username | TEXT | 用户名，唯一 |
| email | TEXT | 邮箱地址，唯一 |
| phone | TEXT | 手机号码 |
| password_hash | TEXT | 密码哈希 |
| status | INTEGER | 用户状态：0-正常，1-禁用，2-待审核 |
| kyc_status | INTEGER | KYC状态：0-未认证，1-待审核，2-已认证，3-认证失败 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |
| last_login_at | DATETIME | 最后登录时间 |

### 钱包表 (wallets)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| user_id | INTEGER | 用户ID，唯一，外键关联 users 表 |
| address | TEXT | 钱包地址，唯一 |
| device | TEXT | 来自哪个签名机设备地址 |
| path | TEXT | 推导路径 |
| chain_type | TEXT | 地址类型：evm、btc、solana |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### 交易记录表 (transactions)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| block_hash | TEXT | 交易哈希 |
| block_no | INTEGER | 交易哈希 |
| tx_hash | TEXT | 交易哈希，唯一 |
| from_addr | TEXT |  发起地址 |
| to_addr | TEXT |  接收地址 |
| token_addr | TEXT |  Token 合约地址 |
| amount | REAL | 交易金额 |
| fee | REAL | 交易手续费 |
| type | TEXT | 交易类型 充值提现归集调度：deposit/withdraw/collect/rebalance |
| status | TEXT | 交易状态：pending/confirmed/failed |
| created_at | DATETIME | 创建时间 |

### 用户余额表 (balances)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，UUID格式 |
| user_id | INTEGER | 用户ID |
| address | TEXT | 钱包地址 |
| token_symbol | TEXT | 代币代号 |
| address_type | INTEGER | 地址类型：0-用户地址，1-热钱包地址(归集地址)，2-多签地址 |
| balance | TEXT | 可用余额，大整数存储 |
| lock_balance | TEXT | 锁定余额，大整数存储 |
| timestamp | INTEGER | 时间戳 |




## 安全注意事项

1. **私钥保护**: API响应中不会返回私钥信息
2. **输入验证**: 所有输入都会进行验证
3. **错误处理**: 统一的错误响应格式
4. **数据库安全**: 使用参数化查询防止SQL注入

## 工作原理

### 钱包创建流程

1. **用户请求**: 用户请求获取钱包地址
2. **检查现有钱包**: 检查用户是否已有钱包
3. **调用 Signer 模块**: 如果用户没有钱包，调用 Signer 模块创建新钱包
4. **数据存储**: 将钱包信息存储到数据库
5. **返回结果**: 返回钱包信息给用户

### 模块架构

- **路由层** (`routes/`): 处理 HTTP 请求和响应
- **业务逻辑层** (`services/`): 实现核心业务逻辑
- **数据访问层** (`db/models/`): 数据库操作和模型定义
- **外部服务** (`services/signerService.ts`): 与 Signer 模块的通信

## 故障排除

### 常见问题

1. **端口被占用**
   ```bash
   # 查看端口占用
   lsof -i :3000
   # 杀死进程
   kill -9 <PID>
   ```

2. **Signer 模块连接失败**
   - 检查 Signer 模块是否已启动
   - 验证 `SIGNER_BASE_URL` 环境变量配置
   - 确认网络连接正常

3. **环境变量未设置**
   - 确保 `wallet/.env` 文件存在
   - 检查 `SIGNER_BASE_URL` 配置是否正确

4. **TypeScript编译错误**
   ```bash
   # 清理并重新编译
   npm run clean
   npm run build
   ```

5. **数据库连接问题**
   - 检查 `wallet.db` 文件权限
   - 确保SQLite3正确安装

## 测试

### 运行测试

项目包含完整的API测试套件，用于验证钱包系统的各项功能。

#### 启动服务器

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

# 获取钱包余额
curl http://localhost:3000/api/wallet/1/balance

# 更新钱包余额
curl -X PUT http://localhost:3000/api/wallet/1/balance \
  -H "Content-Type: application/json" \
  -d '{"balance": 150.0}'
```

