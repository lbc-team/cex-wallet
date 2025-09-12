# CEX钱包系统 - 签名器模块

签名器模块负责从环境变量助记词创建钱包，使用 viem.sh 库实现以太坊钱包的创建和操作。该模块专为 CEX 钱包系统设计，提供安全的地址生成服务。

## 功能特性

- 💼 从环境变量助记词创建钱包
- 🌐 支持多种区块链（EVM、Bitcoin、Solana）
- 🛡️ 安全的密钥管理
- 💾 配置持久化（SQLite 数据库存储当前索引和地址记录）
- 🔄 自动递增派生路径生成唯一地址
- 🏷️ 链类型标记，支持多链地址管理

## 使用场景

- **交易所钱包管理**: 为交易所用户生成唯一的存款地址
- **多链支持**: 支持多种区块链的钱包创建
- **地址隔离**: 每个用户使用不同的派生路径，确保地址唯一性
- **安全存储**: 私钥和助记词的安全管理
- **链类型管理**: 通过 `chain_type` 字段区分不同链的地址

## 技术栈

- **Node.js** - 运行时环境
- **TypeScript** - 类型安全的JavaScript
- **Express.js** - Web应用框架
- **viem.sh** - 以太坊开发库
- **SQLite3** - 轻量级数据库
- **nodemon** - 开发时自动重启

## 项目结构

```
signer/
├── src/
│   ├── db/               # 数据库层
│   │   └── connection.ts
│   ├── services/          # 服务层
│   │   └── addressService.ts
│   ├── routes/           # 路由层
│   │   └── signer.ts
│   ├── types/            # 类型定义
│   │   └── wallet.ts
│   └── index.ts          # 主入口文件
├── dist/                 # 编译输出目录
├── package.json
├── tsconfig.json
├── env.example           # 环境变量示例
└── README.md
```

## 安装和运行

### 安装依赖

```bash
npm install
```

### 设置环境变量

创建 `.env` 文件：
```bash
# 助记词 (必需) - 请替换为您的实际助记词
MNEMONIC=your mnemonic phrase here

# 设备名称 (可选，默认为 signer_device1)
SIGNER_DEVICE=signer_device1

# 服务端口 (可选，默认为 3001)
PORT=3001
```

⚠️ **重要**: 请确保助记词的安全性，不要将包含真实助记词的 `.env` 文件提交到版本控制系统。

### 开发模式

```bash
# 启动开发服务器
npm run dev

# 监听模式（自动重启）
npm run dev:watch
```

### 生产模式

```bash
# 编译TypeScript
npm run build

# 启动生产服务器
npm start
```

启动服务后，系统会提示您输入密码：
```
请输入助记词密码（至少8个字符）:
密码: ********
```

### 密码验证机制
系统使用以下机制验证密码正确性：

1. **首次启动**: 创建验证地址（使用默认路径 `m/44'/60'/0'/0/0` 和索引 0）并保存到地址数据库
2. **后续启动**: 使用输入密码生成相同路径的地址，与存储的验证地址比较
3. **验证失败**: 如果地址不匹配，服务启动失败
4. **地址管理**: 验证地址作为第一个地址记录在数据库中，后续创建的钱包地址从索引 1 开始

## API接口

### 基础信息

- **基础URL**: `http://localhost:3001`
- **健康检查**: `GET /health`

### 钱包创建

#### 创建新钱包

```bash
POST /api/signer/create
```

**请求体**:
```json
{
  "chainType": "evm"
}
```

**支持的链类型**:
- `evm` - EVM兼容链（以太坊、BSC、Polygon等）
- `btc` - 比特币（暂未实现）
- `solana` - Solana（暂未实现）

**响应**:
```json
{
  "success": true,
  "message": "钱包创建成功",
  "data": {
    "address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
    "device": "signer_device1",
    "path": "m/44'/60'/0'/0/0",
    "chainType": "evm",
    "createdAt": "2025-01-01T15:30:00.000Z",
    "updatedAt": "2025-01-01T15:30:00.000Z"
  }
}
```

**错误响应**:
```json
{
  "success": false,
  "error": "错误信息"
}
```

## 支持的区块链

### EVM兼容链（已实现）
- 以太坊 (Ethereum)
- 币安智能链 (BSC)
- 多边形 (Polygon)
- 其他EVM兼容链

### 其他链（计划支持）
- 比特币 (Bitcoin) - 暂未实现
- Solana - 暂未实现

## 安全注意事项

⚠️ **重要安全提醒**:

1. **私钥安全**: 私钥是钱包的核心，必须妥善保管
2. **助记词安全**: 助记词可以恢复整个钱包，不要泄露给任何人
3. **生产环境**: 在生产环境中，建议使用硬件安全模块(HSM)
4. **网络安全**: 确保API服务运行在安全的环境中
5. **密钥加密**: 考虑对存储的私钥进行加密

## 数据库配置

### signer.db

系统会自动创建 SQLite 数据库文件 `signer.db`，包含一个表：

#### generatedAddresses 表
存储已生成的地址和对应的路径信息：
```sql
CREATE TABLE generatedAddresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT UNIQUE NOT NULL,
  path TEXT NOT NULL,
  index_value INTEGER NOT NULL,
  chain_type TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**数据库特性**：
- 自动创建和初始化表结构
- 支持事务操作，确保数据一致性
- 地址唯一性约束，防止重复生成
- 自动时间戳记录
- 链类型标记，支持多链地址管理

**注意事项**：
- 数据库文件会在每次生成新地址时自动更新
- 请勿手动删除或修改数据库文件，以免导致地址重复
- 如需重置，可以删除数据库文件，系统会从索引 0 重新开始

## 工作原理

### 地址生成流程

1. **环境变量读取**: 从 `.env` 文件读取助记词和设备名
2. **密码**是启动 signer 服务的必需参数，通过交互式**隐藏输入**获取
3. **索引管理**: 从数据库获取当前索引，自动递增
4. **路径生成**: 根据链类型生成派生路径（如：`m/44'/60'/0'/0/0` → `m/44'/60'/0'/0/1`）
5. **钱包创建**: 使用助记词和派生路径创建钱包
6. **数据持久化**: 将地址和索引信息保存到数据库

### 派生路径规则

- **EVM链**: `m/44'/60'/0'/0/{index}`
- **比特币**: `m/84'/1'/0'/0/{index}` (计划支持)
- **Solana**: `m/44'/501'/0'/0/{index}` (计划支持)

## 查询数据库

# 查询已生成地址数量
```
sqlite3 signer.db "SELECT COUNT(*) FROM generatedAddresses;"

# 查询 EVM 链的最大索引
sqlite3 signer.db "SELECT MAX(index_value) FROM generatedAddresses WHERE chain_type = 'evm';"
```

## 测试

### 手动测试

```bash
# 健康检查
curl http://localhost:3001/health

# 创建新钱包
curl -X POST http://localhost:3001/api/signer/create \
  -H "Content-Type: application/json" \
  -d '{"chainType":"evm"}'
```

### 测试脚本

```bash
# 运行测试
npm test
```
 
