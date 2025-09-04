# CEX钱包系统 - 签名器模块

签名器模块负责真实的钱包创建和管理，使用viem.sh库实现以太坊钱包的创建和操作。

## 功能特性

- 🔐 生成新的助记词
- 💼 从助记词创建钱包
- 🔑 从私钥创建钱包
- ✅ 验证钱包地址格式
- 🌐 支持多种区块链（EVM、Bitcoin、Solana）
- 🛡️ 安全的密钥管理

## 技术栈

- **Node.js** - 运行时环境
- **TypeScript** - 类型安全的JavaScript
- **Express.js** - Web应用框架
- **viem.sh** - 以太坊开发库
- **nodemon** - 开发时自动重启

## 项目结构

```
signer/
├── src/
│   ├── services/          # 服务层
│   │   └── walletService.ts
│   ├── types/            # 类型定义
│   │   └── wallet.ts
│   └── index.ts          # 主入口文件
├── dist/                 # 编译输出目录
├── package.json
├── tsconfig.json
└── README.md
```

## 安装和运行

### 安装依赖

```bash
npm install
```

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

#### 1. 创建新钱包

```bash
POST /api/wallets/create
```

**请求体**:
```json
{
  "device": "signer-device-001",
  "chainType": "evm",
  "path": "m/44'/60'/0'/0/0"  // 可选，不提供则使用默认路径
}
```

**响应**:
```json
{
  "success": true,
  "message": "钱包创建成功",
  "data": {
    "address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
    "privateKey": "0x...",
    "device": "signer-device-001",
    "path": "m/44'/60'/0'/0/0",
    "chainType": "evm",
    "createdAt": "2025-09-04T15:30:00.000Z",
    "updatedAt": "2025-09-04T15:30:00.000Z"
  }
}
```

#### 2. 从助记词创建钱包

```bash
POST /api/wallets/create-from-mnemonic
```

**请求体**:
```json
{
  "device": "signer-device-001",
  "chainType": "evm",
  "mnemonic": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "path": "m/44'/60'/0'/0/0"  // 可选
}
```

#### 3. 从私钥创建钱包

```bash
POST /api/wallets/create-from-private-key
```

**请求体**:
```json
{
  "device": "signer-device-001",
  "chainType": "evm",
  "privateKey": "0x..."
}
```

### 工具接口

#### 1. 验证钱包地址

```bash
GET /api/wallets/validate-address?address=0x...&chainType=evm
```

**响应**:
```json
{
  "success": true,
  "message": "地址格式有效",
  "data": {
    "address": "0x...",
    "chainType": "evm",
    "isValid": true
  }
}
```

#### 2. 生成助记词

```bash
GET /api/mnemonic/generate?strength=256&language=english
```

**响应**:
```json
{
  "success": true,
  "message": "助记词生成成功",
  "data": {
    "mnemonic": "abandon abandon abandon...",
    "strength": 256,
    "language": "english"
  }
}
```

## 支持的区块链

### EVM兼容链
- 以太坊 (Ethereum)
- 币安智能链 (BSC)
- 多边形 (Polygon)
- 其他EVM兼容链

### 其他链（计划支持）
- 比特币 (Bitcoin)
- Solana

## 安全注意事项

⚠️ **重要安全提醒**:

1. **私钥安全**: 私钥是钱包的核心，必须妥善保管
2. **助记词安全**: 助记词可以恢复整个钱包，不要泄露给任何人
3. **生产环境**: 在生产环境中，建议使用硬件安全模块(HSM)
4. **网络安全**: 确保API服务运行在安全的环境中
5. **密钥加密**: 考虑对存储的私钥进行加密

## 开发指南

### 添加新的区块链支持

1. 在 `src/types/wallet.ts` 中添加新的链类型
2. 在 `src/services/walletService.ts` 中实现对应的钱包创建逻辑
3. 更新API接口以支持新的链类型

### 自定义派生路径

```typescript
const customPaths = {
  evm: "m/44'/60'/0'/0/0",
  btc: "m/44'/0'/0'/0/0",
  solana: "m/44'/501'/0'/0'"
};
```

## 测试

### 手动测试

```bash
# 健康检查
curl http://localhost:3001/health

# 创建新钱包
curl -X POST http://localhost:3001/api/wallets/create \
  -H "Content-Type: application/json" \
  -d '{"device":"test-device","chainType":"evm"}'

# 生成助记词
curl http://localhost:3001/api/mnemonic/generate
```

## 故障排除

### 常见问题

1. **端口冲突**: 默认端口3001被占用
   - 解决方案: 修改环境变量 `PORT` 或停止占用端口的进程

2. **依赖安装失败**: npm install 失败
   - 解决方案: 清除缓存 `npm cache clean --force` 后重新安装

3. **TypeScript编译错误**: 类型错误
   - 解决方案: 检查类型定义和导入语句

## 许可证

ISC License
