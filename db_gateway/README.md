# Database Gateway Service

Database Gateway Service是一个安全的数据库访问网关，使用Ed25519签名验证确保所有数据库操作的安全性.

1. **独立部署**: Database Gateway独立部署
2. **网络隔离**: 只允许内网访问

## 功能特性

- **Ed25519签名验证**: 所有写操作必须经过签名验证
- **权限分级**: 读操作、写操作、敏感操作的分级管理
- **审计日志**: 完整的操作审计和监控
- **模块隔离**: Wallet和Scan模块通过网关访问数据库

## 快速开始

### 1. 安装依赖

```bash
cd db_gateway
npm install
```

### 2. 配置环境变量

复制环境变量模板：
```bash
cp .env.example .env
```

### 3. 生成密钥对

启动开发环境下的服务：
```bash
npm run dev
```

访问密钥生成端点（仅在开发环境可用）：
```bash
curl -X POST http://localhost:3003/generate-keypair
```

将生成的公钥配置到 `.env` 文件中的 `WALLET_PUBLIC_KEY` 和 `SCAN_PUBLIC_KEY`。

### 4. 配置模块私钥

将对应的私钥配置到各模块的环境变量中：
- Wallet模块：`wallet/.env.gateway` 中的 `WALLET_PRIVATE_KEY`
- Scan模块：`scan/.env.gateway` 中的 `SCAN_PRIVATE_KEY`

### 5. 启动服务

```bash
# 开发环境
npm run dev

# 生产环境
npm run build
npm start
```

## API接口

### 数据库操作

#### POST /api/database/execute

执行数据库操作，需要签名验证。

**请求格式**：
```json
{
  "operation_id": "uuid",
  "operation_type": "read|write|sensitive",
  "table": "table_name",
  "action": "select|insert|update|delete",
  "data": { /* 操作数据 */ },
  "conditions": { /* 查询条件 */ },
  "business_signature": "ed25519_signature",
  "timestamp": 1640995200000,
  "module": "wallet|scan"
}
```

**权限等级**：
- `read`: 读操作，只需要模块身份验证
- `write`: 一般写操作，需要模块签名
- `sensitive`: 敏感操作，需要业务签名 + 风控评估


## 签名机制

### 1. 创建签名负载

```typescript
const signaturePayload = {
  operation_id: "uuid",
  operation_type: "write",
  table: "withdraws",
  action: "insert",
  data: { /* 操作数据 */ },
  conditions: null,
  timestamp: Date.now(),
  module: "wallet"
};

const message = JSON.stringify(signaturePayload);
```

### 2. 生成Ed25519签名

```typescript
import * as nacl from 'tweetnacl';

const messageBytes = new TextEncoder().encode(message);
const signature = nacl.sign.detached(messageBytes, privateKey);
const signatureHex = Array.from(signature)
  .map(b => b.toString(16).padStart(2, '0'))
  .join('');
```

### 3. 发送请求

```typescript
const request = {
  ...signaturePayload,
  business_signature: signatureHex
};

const response = await fetch('/api/database/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(request)
});
```


## 安全控制

1. **时间戳验证**: 防重放攻击，5分钟时间窗口
2. **签名验证**: Ed25519数字签名确保请求来源
4. **权限隔离**: 模块无法绕过网关直接访问数据库
