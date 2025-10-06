# Risk Control Service

风控服务 - 为 CEX 钱包系统提供风险评估和签名授权。

## 功能特性

- ✅ **风险评估** - 对存款、提现等操作进行风控检查
- ✅ **黑名单检测** - 检查地址是否在黑名单中
- ✅ **大额交易监控** - 对超过阈值的交易进行特殊处理
- ✅ **风控签名** - 使用 Ed25519 对批准的操作进行签名
- ✅ **灵活决策** - 支持批准、冻结、拒绝、人工审核等决策

## 架构

```
┌─────────┐         ┌──────────────┐         ┌──────────────┐
│  Scan   │────────>│ Risk Control │<────────│   Wallet     │
└─────────┘ 1.请求  └──────────────┘ 1.请求  └──────────────┘
              评估            │
                              │ 2.返回签名
                              ▼
                       ┌──────────────┐
                       │  DB Gateway  │
                       └──────────────┘
                         3.验证双签名
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 生成密钥对

```bash
npm run generate-keypair
```

这会生成一对 Ed25519 密钥：
- **Private Key** - 配置到 risk_control 的 `.env`
- **Public Key** - 配置到 db_gateway 的 `.env`

### 3. 配置环境变量

复制 `.env.example` 到 `.env`：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
PORT=3004
NODE_ENV=development
RISK_PRIVATE_KEY=<生成的私钥>
RISK_CONTROL_DB_PATH=/absolute/path/to/risk_control.db
```

### 4. 启动服务

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm run build
npm start
```

服务将在 `http://localhost:3004` 启动。

## API 端点

### 1. 健康检查

```bash
GET /health
```

### 2. 风控评估

```bash
POST /api/assess
```

**请求体：**

```json
{
  "operation_id": "550e8400-e29b-41d4-a716-446655440000",
  "event_type": "deposit",
  "operation_type": "sensitive",
  "table": "credits",
  "action": "insert",
  "user_id": 123,
  "amount": "1000000000000000000",
  "from_address": "0xabc...",
  "tx_hash": "0x123...",
  "data": {
    "user_id": 123,
    "address": "0x...",
    "token_id": 1,
    "amount": "1000000000000000000",
    "credit_type": "deposit",
    "business_type": "user_deposit",
    "reference_id": "0x123...",
    "reference_type": "tx_hash"
  }
}
```

**响应（批准）：**

```json
{
  "success": true,
  "decision": "approve",
  "operation_id": "uuid-v4",
  "db_operation": {
    "table": "credits",
    "action": "insert",
    "data": { ... }
  },
  "risk_signature": "abc123...",
  "timestamp": 1234567890,
  "risk_level": "low",
  "risk_score": 10,
  "reasons": ["Normal transaction"]
}
```

**响应（冻结）：**

```json
{
  "success": true,
  "decision": "freeze",
  "operation_id": "uuid-v4",
  "db_operation": {
    "table": "credits",
    "action": "insert",
    "data": {
      ...
      "status": "frozen"
    }
  },
  "risk_signature": "abc123...",
  "timestamp": 1234567890,
  "risk_level": "critical",
  "risk_score": 100,
  "reasons": ["From address is blacklisted: Known scammer"]
}
```

## 风控规则


系统内置以下风控规则：

1. **大额提现**: 超过阈值的提现需要人工审核
2. **频繁提现**: 短时间内多次提现
3. **新地址提现**: 向未知地址提现
4. **Credit操作**: 大额余额变更

### 风险等级

- **Low (0-30分)**: 自动通过
- **Medium (31-70分)**: 需要1个审批
- **High (71-90分)**: 需要2个审批
- **Critical (91+分)**: 直接拒绝

当前实现的风控规则（模拟）：

### 1. 黑名单检测（100分）
- 检查 `from_address` 和 `to_address`
- 命中黑名单直接冻结

### 2. 高风险用户（50分）
- 检查 `user_id` 是否在高风险列表

### 3. 大额交易（30分）
- 单笔金额超过 10 ETH

### 4. 敏感操作（20分）
- `operation_type === 'sensitive'`

### 5. 提现操作（10分）
- `event_type === 'withdraw'`

### 决策逻辑

- **≥100分** → `freeze`（冻结）
- **70-99分** → `manual_review`（人工审核）
- **40-69分** → `approve`（批准，中等风险）
- **<40分** → `approve`（批准，低风险）

## 测试

### 测试正常存款

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
    "from_address": "0xnormal",
    "data": {
      "user_id": 123,
      "amount": "1000000000000000000",
      "status": "confirmed"
    }
  }'
```

### 测试黑名单地址（会被冻结）

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
      "amount": "1000000000000000000"
    }
  }'
```

## 与 DB Gateway 集成

1. **获取风控公钥**：
   ```bash
   curl http://localhost:3004/api/public-key
   ```

2. **配置到 DB Gateway**：
   在 db_gateway 的 `.env` 中添加：
   ```env
   RISK_PUBLIC_KEY=<风控公钥>
   ```

3. **业务流程**：
   ```
   Scan 生成 operation_id
   ↓
   Scan → Risk Control (传入 operation_id，获取风控签名)
   ↓
   Scan → DB Gateway (使用同一个 operation_id，发送业务签名 + 风控签名)
   ↓
   DB Gateway → 验证双签名 → 检查 operation_id 未使用 → 执行数据库操作
   ```

## 开发

### 项目结构

```
risk_control/
├── src/
│   ├── controllers/      # API 控制器
│   ├── services/         # 业务逻辑
│   ├── utils/            # 工具类
│   ├── types/            # 类型定义
│   ├── scripts/          # 脚本
│   └── index.ts          # 入口文件
├── package.json
├── tsconfig.json
└── README.md
```

### 添加新的风控规则

编辑 `src/services/risk-assessment.ts` 中的 `checkRiskRules` 方法：

```typescript
// 新规则示例
if (request.event_type === 'withdraw' && request.amount) {
  const dailyLimit = await this.checkDailyWithdrawLimit(request.user_id);
  if (dailyLimit.exceeded) {
    reasons.push('Daily withdraw limit exceeded');
    risk_score += 60;
  }
}
```

## 注意事项

1. **私钥安全**
   - 永远不要提交私钥到版本控制
   - 生产环境使用密钥管理服务
   - 定期轮换密钥

2. **黑名单管理**
   - 当前黑名单在内存中（重启会丢失）
   - 生产环境应使用数据库或 Redis
   - 实现黑名单的增删改查 API

3. **性能优化**
   - 黑名单查询可使用 Redis 缓存
   - 大额交易阈值可动态配置
   - 风控规则可异步执行

4. **监控和告警**
   - 记录所有风控决策
   - 对高风险操作发送告警
   - 监控风控服务的可用性

## License

ISC
