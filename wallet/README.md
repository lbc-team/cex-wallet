# CEX钱包系统 - 主模块

这是CEX钱包系统的主模块，提供钱包管理、余额查询、交易记录等核心功能。

## 技术栈

- **Node.js** - 运行时环境
- **TypeScript** - 类型安全的JavaScript超集
- **Express.js** - Web应用框架
- **SQLite3** - 轻量级数据库
- **ts-node** - TypeScript直接运行工具

## 项目结构

```
wallet/
├── src/
│   └── index.ts          # 主服务器文件
├── dist/                 # TypeScript编译输出
├── tsconfig.json         # TypeScript配置
├── package.json          # 项目配置和依赖
└── README.md            # 项目说明文档
```

## 安装依赖

```bash
npm install
```

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

#### 2. 获取所有钱包
```http
GET /api/wallets
```
**响应示例**:
```json
{
  "data": [
    {
      "id": 1,
      "address": "0x1234...",
      "balance": 100.5,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

#### 3. 创建新钱包
```http
POST /api/wallets
Content-Type: application/json

{
  "address": "0x1234567890abcdef...",
  "private_key": "your_private_key_here"
}
```
**响应示例**:
```json
{
  "message": "钱包创建成功",
  "data": {
    "id": 1,
    "address": "0x1234567890abcdef..."
  }
}
```

#### 4. 获取钱包详情
```http
GET /api/wallets/:id
```
**响应示例**:
```json
{
  "data": {
    "id": 1,
    "address": "0x1234...",
    "balance": 100.5,
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

#### 5. 获取钱包余额
```http
GET /api/wallets/:id/balance
```
**响应示例**:
```json
{
  "data": {
    "balance": 100.5
  }
}
```

#### 6. 获取钱包交易记录
```http
GET /api/wallets/:id/transactions
```
**响应示例**:
```json
{
  "data": [
    {
      "id": 1,
      "wallet_id": 1,
      "tx_hash": "0xabc123...",
      "amount": 50.0,
      "type": "deposit",
      "status": "confirmed",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
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
| address | TEXT | 钱包地址，唯一 |
| device | TEXT | 签名机设备地址 |
| path | TEXT | 推导路径 |
| chain_type | TEXT | 地址类型： evm、btc、solana |
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



## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| PORT | 3000 | 服务器端口 |

## 安全注意事项

1. **私钥保护**: API响应中不会返回私钥信息
2. **输入验证**: 所有输入都会进行验证
3. **错误处理**: 统一的错误响应格式
4. **数据库安全**: 使用参数化查询防止SQL注入

## 开发指南

### 添加新的API端点

1. 在 `src/index.ts` 中添加新的路由
2. 定义相应的TypeScript接口
3. 实现业务逻辑
4. 添加错误处理

### 数据库操作

使用SQLite3的Promise包装或回调方式：

```typescript
// 查询示例
db.get('SELECT * FROM wallets WHERE id = ?', [walletId], (err, row) => {
  if (err) {
    // 错误处理
  }
  // 处理结果
});

// 插入示例
db.run('INSERT INTO wallets (address, private_key) VALUES (?, ?)', 
  [address, private_key], function(err) {
  if (err) {
    // 错误处理
  }
  // 处理结果
});
```

## 故障排除

### 常见问题

1. **端口被占用**
   ```bash
   # 查看端口占用
   lsof -i :3000
   # 杀死进程
   kill -9 <PID>
   ```

2. **TypeScript编译错误**
   ```bash
   # 清理并重新编译
   npm run clean
   npm run build
   ```

3. **数据库连接问题**
   - 检查 `wallet.db` 文件权限
   - 确保SQLite3正确安装

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 许可证

ISC License
