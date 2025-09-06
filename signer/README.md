# CEX钱包系统 - 签名器模块

签名器模块负责从环境变量助记词创建钱包，使用 viem.sh 库实现以太坊钱包的创建和操作。该模块专为 CEX 钱包系统设计，提供安全的地址生成服务。

## 功能特性

- 💼 从环境变量助记词创建钱包
- 🌐 支持多种区块链（EVM、Bitcoin、Solana）
- 🛡️ 安全的密钥管理
- 💾 配置持久化（SQLite 数据库存储当前索引和地址记录）
- 🔄 自动递增派生路径生成唯一地址

## 使用场景

- **交易所钱包管理**: 为交易所用户生成唯一的存款地址
- **多链支持**: 支持多种区块链的钱包创建
- **地址隔离**: 每个用户使用不同的派生路径，确保地址唯一性
- **安全存储**: 私钥和助记词的安全管理

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
    "privateKey": "0x...",
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

### signer-config.db

系统会自动创建 SQLite 数据库文件 `signer-config.db`，包含两个表：

#### currentIndex 表
存储当前使用的派生路径索引：
```sql
CREATE TABLE currentIndex (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### generatedAddresses 表
存储已生成的地址和对应的路径信息：
```sql
CREATE TABLE generatedAddresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT UNIQUE NOT NULL,
  path TEXT NOT NULL,
  index_value INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**数据库特性**：
- 自动创建和初始化表结构
- 支持事务操作，确保数据一致性
- 地址唯一性约束，防止重复生成
- 自动时间戳记录

**注意事项**：
- 数据库文件会在每次生成新地址时自动更新
- 请勿手动删除或修改数据库文件，以免导致地址重复
- 如需重置，可以删除数据库文件，系统会从索引 0 重新开始

## 工作原理

### 地址生成流程

1. **环境变量读取**: 从 `.env` 文件读取助记词和设备名
2. **索引管理**: 从数据库获取当前索引，自动递增
3. **路径生成**: 根据链类型生成派生路径（如：`m/44'/60'/0'/0/0` → `m/44'/60'/0'/0/1`）
4. **钱包创建**: 使用助记词和派生路径创建钱包
5. **数据持久化**: 将地址和索引信息保存到数据库

### 派生路径规则

- **EVM链**: `m/44'/60'/0'/0/{index}`
- **比特币**: `m/84'/1'/0'/0/{index}` (计划支持)
- **Solana**: `m/44'/501'/0'/0/{index}` (计划支持)

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

## 故障排除

### 常见问题

1. **端口冲突**: 默认端口3001被占用
   - 解决方案: 修改 `.env` 文件中的 `PORT` 或停止占用端口的进程

2. **环境变量未设置**: 启动时提示环境变量错误
   - 解决方案: 确保 `signer/.env` 文件存在且包含 `MNEMONIC` 变量

3. **数据库错误**: SQLite 数据库相关错误
   - 解决方案: 删除 `signer-config.db` 文件，系统会重新创建

4. **依赖安装失败**: npm install 失败
   - 解决方案: 清除缓存 `npm cache clean --force` 后重新安装

5. **TypeScript编译错误**: 类型错误
   - 解决方案: 检查类型定义和导入语句

## 许可证

ISC License
