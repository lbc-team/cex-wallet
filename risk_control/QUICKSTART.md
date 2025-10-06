# Risk Control Service - 快速启动指南

## 一、安装和配置

### 1. 安装依赖

```bash
cd risk_control
npm install
```

### 2. 生成密钥对

```bash
npm run generate-keypair
```

输出示例：
```
=== Risk Control Service - Key Pair Generator ===

✅ New Ed25519 key pair generated successfully!

📋 Copy these values to your .env file:

Public Key (share with db_gateway):
RISK_PUBLIC_KEY=abc123...

Private Key (keep SECRET in risk_control service):
RISK_PRIVATE_KEY=def456...

⚠️  WARNING: Never commit the private key to version control!
```

### 3. 创建 .env 文件

```bash
cp .env.example .env
```

编辑 `.env`，填入生成的私钥：
```env
PORT=3004
NODE_ENV=development
RISK_PRIVATE_KEY=<刚才生成的私钥>
```

### 4. 启动服务

```bash
npm run dev
```

看到以下输出表示启动成功：
```
Risk Control Service started { port: 3004, nodeEnv: 'development', pid: 12345 }
Risk Control Public Key { publicKey: 'abc123...', note: 'Configure this in db_gateway as RISK_PUBLIC_KEY' }
```

## 二、配置 DB Gateway

将生成的**公钥**配置到 db_gateway：

```bash
cd ../db_gateway
```

编辑 `db_gateway/.env`，添加：
```env
RISK_PUBLIC_KEY=<风控服务的公钥>
```

重启 db_gateway 服务。

## 三、测试风控服务

### 测试 1: 健康检查

```bash
curl http://localhost:3004/health
```

### 测试 2: 获取公钥

```bash
curl http://localhost:3004/api/public-key
```

### 测试 3: 正常存款（会批准）

```bash
curl -X POST http://localhost:3004/api/assess \
  -H "Content-Type: application/json" \
  -d '{
    "operation_id": "550e8400-e29b-41d4-a716-446655440001",
    "event_type": "deposit",
    "operation_type": "sensitive",
    "table": "credits",
    "action": "insert",
    "user_id": 123,
    "amount": "1000000000000000000",
    "from_address": "0x1234567890abcdef",
    "data": {
      "user_id": 123,
      "address": "0x...",
      "token_id": 1,
      "amount": "1000000000000000000",
      "credit_type": "deposit",
      "business_type": "blockchain",
      "reference_id": "0x1234...",
      "reference_type": "tx_hash"
    }
  }'
```

**预期响应：**
```json
{
  "success": true,
  "decision": "approve",
  "operation_id": "uuid-...",
  "risk_level": "low",
  "risk_score": 30
}
```

### 测试 4: 黑名单地址（会冻结）

```bash
curl -X POST http://localhost:3004/api/assess \
  -H "Content-Type: application/json" \
  -d '{
    "operation_id": "550e8400-e29b-41d4-a716-446655440002",
    "event_type": "deposit",
    "operation_type": "sensitive",
    "table": "credits",
    "action": "insert",
    "user_id": 123,
    "amount": "1000000000000000000",
    "from_address": "0xBlacklistAddress",
    "data": {
      "user_id": 123,
      "address": "0x...",
      "token_id": 1,
      "amount": "1000000000000000000",
      "credit_type": "deposit"
    }
  }'
```

**预期响应：**
```json
{
  "success": true,
  "decision": "freeze",
  "operation_id": "uuid-...",
  "db_operation": {
    "data": {
      "status": "frozen"  // 注意这里变成了 frozen
    }
  },
  "risk_level": "critical",
  "risk_score": 100,
  "reasons": ["From address is blacklisted: Test blacklist"]
}
```

## 四、与 Scan 集成的完整流程

### Scan 端代码示例（TypeScript）

```typescript
import { v4 as uuidv4 } from 'uuid';

// 1. Scan 检测到存款，生成 operation_id
const operation_id = uuidv4();
const deposit = {
  user_id: 123,
  from_address: '0xabc...',
  amount: '1000000000000000000',
  tx_hash: '0x123...'
};

// 2. 请求风控评估（传入 operation_id）
const riskResponse = await fetch('http://localhost:3004/api/assess', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    operation_id,  // 业务层生成的唯一ID
    event_type: 'deposit',
    operation_type: 'sensitive',
    table: 'credits',
    action: 'insert',
    user_id: deposit.user_id,
    amount: deposit.amount,
    from_address: deposit.from_address,
    data: {
      user_id: deposit.user_id,
      address: '0x...',
      token_id: 1,
      amount: deposit.amount,
      credit_type: 'deposit',
      business_type: 'user_deposit',
      reference_id: deposit.tx_hash,
      reference_type: 'tx_hash'
    }
  })
}).then(r => r.json());

// 3. 使用相同的 operation_id
const gatewayRequest = {
  operation_id,  // 复用之前生成的 operation_id
  operation_type: 'sensitive',
  table: riskResponse.db_operation.table,
  action: riskResponse.db_operation.action,
  data: riskResponse.db_operation.data,
  timestamp: riskResponse.timestamp,
  risk_signature: riskResponse.risk_signature,  // 风控签名
};

// 4. 添加业务签名
const signaturePayload = {
  operation_id: gatewayRequest.operation_id,
  operation_type: gatewayRequest.operation_type,
  table: gatewayRequest.table,
  action: gatewayRequest.action,
  data: gatewayRequest.data,
  conditions: null,
  timestamp: gatewayRequest.timestamp
};

const business_signature = signer.sign(signaturePayload);

// 5. 发送到 DB Gateway（双签名）
const dbResponse = await fetch('http://localhost:3003/api/database/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ...gatewayRequest,
    business_signature
  })
}).then(r => r.json());

console.log('存款记录已保存:', dbResponse);
```

## 五、内置的测试数据

### 黑名单地址
- `0xblacklist001` - Known scammer
- `0xblacklist002` - Money laundering
- `0xBlacklistAddress` - Test blacklist

### 高风险用户
- `user_id: 666`
- `user_id: 999`

### 大额交易阈值
- `10 ETH` (10000000000000000000 wei)

## 六、常见问题

### Q: 如何修改黑名单？
A: 编辑 `src/services/risk-assessment.ts` 中的 `blacklistAddresses` Map。生产环境应使用数据库。

### Q: 如何调整风控规则？
A: 编辑 `src/services/risk-assessment.ts` 中的 `checkRiskRules` 方法。

### Q: 风控签名验证失败？
A: 确保 db_gateway 的 `RISK_PUBLIC_KEY` 与 risk_control 生成的公钥一致。

### Q: 如何添加新的风控规则？
A: 在 `checkRiskRules` 方法中添加逻辑，累加 `risk_score`，返回相应的 `decision`。

## 七、下一步

1. ✅ 测试各种场景（正常、黑名单、大额）
2. ✅ 集成到 Scan 服务
3. ✅ 集成到 Wallet 服务
4. ✅ 监控风控服务日志
5. ✅ 根据业务需求调整风控规则

## 服务端口


