# 双签名验证系统使用说明

## 概述

DB Gateway 现已实现双签名验证机制，用于敏感操作的安全控制。该机制要求业务层（Scan/Wallet）先向风控层请求评估，获得风控签名后，加上自己的业务签名一起发送给 DB Gateway。

## 架构设计

```
┌─────────┐      1. 请求评估        ┌─────────┐
│  Scan   │─────────────────────────>│  Risk   │
│ 业务层  │                          │ 风控层  │
└─────────┘                          └─────────┘
     │                                    │
     │                                    │ 2. 返回决策+签名
     │<───────────────────────────────────┘
     │                                    {
     │                                      decision: 'freeze',
     │                                      data: {...},
     │                                      risk_signature: 'xxx',
     │                                      nonce: 'uuid',
     │                                      timestamp: xxx
     │                                    }
     │
     │ 3. 添加业务签名
     │
     │      4. 双签名请求        ┌──────────────┐
     └───────────────────────────>│  DB Gateway  │
                                  └──────────────┘
                                        │
                                        │ 5. 验证双签名
                                        │    - 验证业务签名
                                        │    - 验证风控签名
                                        │    - 验证 nonce
                                        │    - 验证时间戳
                                        │
                                        ▼
                                   执行数据库操作
```

## 工作流程

### 1. Scan 检测到用户存款

```typescript
// Scan 检测到存款事件
const depositEvent = {
  user_id: 123,
  amount: '1000000000000000000', // 1 ETH in wei
  from_address: '0xabc...',
  tx_hash: '0x123...',
  token_id: 1
};
```

### 2. Scan 请求风控评估

```typescript
// 向风控层请求评估
const riskRequest = {
  event_type: 'deposit',
  user_id: 123,
  amount: '1000000000000000000',
  from_address: '0xabc...',
  tx_hash: '0x123...',
  token_id: 1
};

const riskResponse = await fetch('http://risk-service/api/assess', {
  method: 'POST',
  body: JSON.stringify(riskRequest)
});
```

### 3. 风控层评估并返回决策

```typescript
// 风控层返回（原样返回业务层传入的 operation_id）
{
  decision: 'freeze' | 'approve',
  operation_id: 'uuid-v4-string',  // 业务层传入的 operation_id
  db_operation: {
    table: 'credits',
    action: 'insert',
    data: {
      user_id: 123,
      address: '0x...',
      token_id: 1,
      amount: '1000000000000000000',
      status: 'frozen',  // 或 'confirmed'
      credit_type: 'deposit',
      business_type: 'user_deposit',
      reference_id: '0x123...',
      reference_type: 'tx_hash',
      tx_hash: '0x123...'
    }
  },
  risk_signature: 'abc123...',  // 风控对 db_operation 的签名
  timestamp: 1234567890
}
```

### 4. Scan 添加业务签名并发送到 DB Gateway

```typescript
import { Ed25519Signer } from './utils/crypto';
import { v4 as uuidv4 } from 'uuid';

const signer = new Ed25519Signer(process.env.SCAN_PRIVATE_KEY);

// 1. 业务层生成 operation_id
const operation_id = uuidv4();

// 2. 请求风控评估（传入 operation_id）
const riskResponse = await riskService.assess({
  operation_id,  // 业务层生成的 operation_id
  // ... 其他参数
});

// 3. 构建要发送到 DB Gateway 的请求（使用相同的 operation_id）
const gatewayRequest = {
  operation_id,  // 复用业务层生成的 operation_id
  operation_type: 'sensitive',  // 敏感操作
  table: riskResponse.db_operation.table,
  action: riskResponse.db_operation.action,
  data: riskResponse.db_operation.data,
  timestamp: riskResponse.timestamp,
  risk_signature: riskResponse.risk_signature,  // 来自风控
  module: 'scan'
};

// 创建签名负载（与风控签名的数据一致）
const signaturePayload = {
  operation_id: gatewayRequest.operation_id,
  operation_type: gatewayRequest.operation_type,
  table: gatewayRequest.table,
  action: gatewayRequest.action,
  data: gatewayRequest.data,
  conditions: null,
  timestamp: gatewayRequest.timestamp,
  module: gatewayRequest.module
};

// Scan 添加自己的签名
const business_signature = signer.sign(JSON.stringify(signaturePayload));

// 发送到 DB Gateway
const response = await fetch('http://db-gateway:3003/api/database/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ...gatewayRequest,
    business_signature
  })
});
```

### 5. DB Gateway 验证双签名

DB Gateway 会按以下顺序验证：

1. ✅ **验证请求格式** - 检查必需字段
2. ✅ **验证时间戳** - 确保请求在5分钟有效期内
3. ✅ **验证业务签名** - 用 Scan 的公钥验证 business_signature
4. ✅ **验证 operation_id** - 检查 operation_id 未被使用（防重放攻击）
5. ✅ **验证风控签名** - 用 Risk 的公钥验证 risk_signature
6. ✅ **验证数据一致性** - 确保业务签名和风控签名针对相同数据
7. ✅ **执行数据库操作** - 所有验证通过后执行

## 环境配置

在 DB Gateway 的 `.env` 文件中配置三个公钥：

```bash
# Wallet 服务的公钥
WALLET_PUBLIC_KEY=abc123...

# Scan 服务的公钥
SCAN_PUBLIC_KEY=def456...

# Risk 风控系统的公钥
RISK_PUBLIC_KEY=ghi789...
```

## 签名数据格式

业务签名和风控签名必须对**完全相同**的数据进行签名：

```json
{
  "operation_id": "uuid-v4",
  "operation_type": "sensitive",
  "table": "credits",
  "action": "insert",
  "data": { ... },
  "conditions": null,
  "timestamp": 1234567890,
  "module": "scan"
}
```

**注意**：`operation_id` 同时用作防重放攻击的 nonce，无需单独的 nonce 字段。

## 安全特性

### 1. 双重授权
- 风控层必须先批准操作
- 业务层必须确认执行
- 任何一方的签名无效都会导致操作失败

### 2. 防重放攻击
- 使用 operation_id 作为 nonce（UUID 保证唯一性）
- DB Gateway 记录已使用的 operation_id
- operation_id 有 5 分钟有效期（配合 timestamp）

### 3. 时效性控制
- timestamp 必须在当前时间的 ±5 分钟内
- 超时请求会被拒绝

### 4. 数据绑定
- 签名与具体的操作参数绑定
- 任何参数被篡改都会导致签名失效

### 5. 审计追踪
- 所有敏感操作都有完整的日志记录
- 包含双方签名和操作详情

## 错误处理

### 缺少风控签名
```json
{
  "success": false,
  "error": {
    "code": "MISSING_RISK_SIGNATURE",
    "message": "Risk signature is required for sensitive operations"
  }
}
```

### Operation ID 已被使用（重放攻击）
```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_OPERATION_ID",
    "message": "Operation ID has already been used",
    "details": "This operation_id has already been used. Possible replay attack detected."
  }
}
```

### 风控签名验证失败
```json
{
  "success": false,
  "error": {
    "code": "RISK_SIGNATURE_VERIFICATION_FAILED",
    "message": "Risk control signature verification failed"
  }
}
```

### 业务签名验证失败
```json
{
  "success": false,
  "error": {
    "code": "SIGNATURE_VERIFICATION_FAILED",
    "message": "Business signature verification failed"
  }
}
```

## 示例：完整的存款冻结流程

```typescript
import { v4 as uuidv4 } from 'uuid';

// 1. Scan 检测到来自黑名单地址的存款，生成 operation_id
const operation_id = uuidv4();
const deposit = {
  user_id: 123,
  from_address: '0xBlacklistAddress',
  amount: '1000000000000000000',
  tx_hash: '0x123abc...'
};

// 2. 请求风控评估（传入 operation_id）
const riskResponse = await riskService.assessDeposit({
  operation_id,  // 业务层生成的 operation_id
  event_type: 'deposit',
  user_id: deposit.user_id,
  from_address: deposit.from_address,
  amount: deposit.amount,
  tx_hash: deposit.tx_hash
});

// 风控返回冻结决策（原样返回 operation_id）
// {
//   decision: 'freeze',
//   operation_id: 'uuid-1',  // 与传入的相同
//   db_operation: {
//     table: 'credits',
//     action: 'insert',
//     data: {
//       user_id: 123,
//       amount: '1000000000000000000',
//       status: 'frozen',
//       reason: 'blacklist_address'
//     }
//   },
//   risk_signature: 'xxx',
//   timestamp: 1234567890
// }

// 3. Scan 添加业务签名（使用相同的 operation_id）
const gatewayRequest = {
  operation_id,  // 复用业务层生成的 operation_id
  operation_type: 'sensitive',
  ...riskResponse.db_operation,
  timestamp: riskResponse.timestamp,
  risk_signature: riskResponse.risk_signature,
  module: 'scan'
};

const signaturePayload = {
  operation_id: gatewayRequest.operation_id,
  operation_type: gatewayRequest.operation_type,
  table: gatewayRequest.table,
  action: gatewayRequest.action,
  data: gatewayRequest.data,
  conditions: null,
  timestamp: gatewayRequest.timestamp,
  module: 'scan'
};

gatewayRequest.business_signature = signer.sign(
  JSON.stringify(signaturePayload)
);

// 4. 发送到 DB Gateway
const result = await dbGateway.execute(gatewayRequest);

// 5. 成功响应
// {
//   success: true,
//   operation_id: 'uuid-2',
//   data: { lastID: 456, changes: 1 }
// }

console.log('存款已冻结，记录ID:', result.data.lastID);
```

## 最佳实践

1. **风控签名时效性**
   - 风控签名应该有短暂的有效期（建议 5 分钟）
   - 业务层应立即使用风控返回的签名

2. **Operation ID 管理**
   - 业务层生成 operation_id（UUID v4）
   - 风控层原样返回业务层传入的 operation_id
   - DB Gateway 使用 operation_id 作为防重放的 nonce
   - 同一个 operation_id 贯穿整个流程，便于追踪

3. **错误处理**
   - 捕获所有签名验证失败的情况
   - 记录可疑的重放攻击尝试

4. **日志记录**
   - 记录所有敏感操作的双签名信息
   - 便于审计和问题追踪

5. **密钥管理**
   - 私钥必须安全存储（使用环境变量或密钥管理服务）
   - 公钥可以公开配置
   - 定期轮换密钥对

## 相关文件

- `/db_gateway/src/services/operation-id.ts` - Operation ID 管理服务（防重放攻击）
- `/db_gateway/src/middleware/signature.ts` - 双签名验证中间件
- `/db_gateway/src/utils/crypto.ts` - 加密工具类
- `/db_gateway/src/types/index.ts` - 类型定义
