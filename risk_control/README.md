# Risk Control Service

风控服务 - 一个独立的微服务，负责对钱包系统的关键操作（如提现、充值等）进行风险评估和人工审核。评估通过后签名授权。

## 功能

- ✅ **风险评估** - 对存款、提现等操作进行风控检查
- ✅ **简单风控黑名单检测** - 检查地址是否在黑名单中
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

## 2. 数据库设计

### 2.1 risk_assessments (风控评估记录表)

```
wallet.db (withdraws)           risk_control.db (risk_assessments)
├─ operation_id (UUID) ◄────────────► operation_id (UUID)
└─ status                             └─ decision, approval_status

```

与业务表双向关联机制

存储所有风控评估记录，包括自动批准、人工审核、拒绝等。

```sql
CREATE TABLE risk_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT UNIQUE NOT NULL,     -- 操作ID (由业务层生成的UUID)
  table_name TEXT,                       -- 业务表名 (withdrawals/credits) ，提现评估时为空
  record_id INTEGER,                     -- 业务表记录ID (双向关联)
  action TEXT NOT NULL,                  -- 操作类型 (insert/update/delete)
  user_id INTEGER,                       -- 关联用户ID

  -- 操作数据
  operation_data TEXT NOT NULL,          -- JSON: 原始操作数据, 如果是提现保存交易信息
  suggest_operation_data TEXT,           -- JSON: 风控建议的操作数据
  suggest_reason TEXT,                   -- 建议原因说明

  -- 风控结果
  risk_level TEXT NOT NULL,              -- low/medium/high/critical
  decision TEXT NOT NULL,                -- auto_approve/manual_review/deny
  approval_status TEXT,                  -- pending/approved/rejected (仅用于manual_review)
  reasons TEXT,                          -- JSON: 风险原因数组

  -- 签名和过期
  risk_signature TEXT,                   -- 风控签名
  expires_at DATETIME,                   -- 签名过期时间

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**关键字段说明**：

- `operation_id`: 由业务层生成的UUID，用于关联业务记录
- `record_id`: 业务表的记录ID，用于双向关联
- `decision`: 风控决策
  - `auto_approve`: 自动批准（低风险）
  - `manual_review`: 需要人工审核（中高风险）
  - `deny`: 直接拒绝（高风险，如黑名单地址）
- `approval_status`: 审批状态（仅用于 manual_review）
  - `pending`: 等待审核
  - `approved`: 审核通过
  - `rejected`: 审核拒绝


### 2.2 risk_manual_reviews (人工审批记录表)

记录所有人工审核操作，包括审核员信息、审核结果等。

```sql
CREATE TABLE risk_manual_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL,        -- 关联 risk_assessments.id
  operation_id TEXT NOT NULL,            -- 关联 operation_id

  approver_user_id INTEGER NOT NULL,     -- 审核员用户ID
  approver_username TEXT,                -- 审核员用户名
  approved INTEGER NOT NULL,             -- 0=拒绝, 1=批准

  modified_data TEXT,                    -- JSON: 审核员修改后的数据
  comment TEXT,                          -- 审核意见
  ip_address TEXT,                       -- 审核员IP
  user_agent TEXT,                       -- 用户代理

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (assessment_id) REFERENCES risk_assessments(id)
);
```

### 2.3 address_risk_list (地址风险表)

管理风险地址，包括黑名单、白名单等。

```sql
CREATE TABLE address_risk_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,                 -- 地址
  chain_type TEXT NOT NULL,              -- evm/btc/solana

  risk_type TEXT NOT NULL,               -- blacklist/whitelist/suspicious/sanctioned
  risk_level TEXT DEFAULT 'medium',      -- low/medium/high
  reason TEXT,                           -- 风险原因
  source TEXT DEFAULT 'manual',          -- manual/auto/chainalysis/ofac

  enabled INTEGER DEFAULT 1,             -- 是否启用

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(address, chain_type)
);
```

### 2.4 数据库关联关系

```
┌─────────────────────┐
│  wallet.db          │
│  ┌────────────────┐ │
│  │ withdrawals    │ │
│  │  - id          │ │
│  │  - operation_id│─┼─────┐
│  │  - status      │ │     │
│  └────────────────┘ │     │
│  ┌────────────────┐ │     │
│  │ credits        │ │     │
│  │  - id          │ │     │
│  │  - operation_id│─┼─────┤
│  └────────────────┘ │     │
└─────────────────────┘     │
                            │
                            ↓
┌──────────────────────────────────────┐
│  risk_control.db                     │
│  ┌─────────────────────────────────┐ │
│  │ risk_assessments                │ │
│  │  - operation_id (UNIQUE)        │ │
│  │  - record_id                    │ │
│  │  - decision                     │ │
│  │  - approval_status              │ │
│  └─────────────────────────────────┘ │
│           ↓                           │
│  ┌─────────────────────────────────┐ │
│  │ risk_manual_reviews             │ │
│  │  - assessment_id (FK)           │ │
│  │  - operation_id                 │ │
│  │  - approved                     │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

## 技术栈

- **语言**: TypeScript
- **运行时**: Node.js
- **框架**: Express.js
- **数据库**: SQLite (risk_control.db)
- **签名**: Ed25519 


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

## API 接口

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


1. 提现风险评估接口

**端点**: `POST /api/withdraw-risk-assessment`

**请求参数**:
```typescript
{
  operation_id: string;    // UUID，由 wallet 服务生成
  transaction: {
    from: string;          // 热钱包地址
    to: string;            // 提现目标地址
    amount: string;        // 提现金额（最小单位）
    tokenAddress?: string; // 代币合约地址（可选）
    chainId: number;       // 链ID
    nonce: number;         // 交易 nonce
  };
  timestamp: number;       // 时间戳
}
```

**响应**:

成功（200）:
```typescript
{
  success: true;
  risk_signature: string;                                    // 风控签名
  decision: 'approve' | 'manual_review';                     // 风控决策
  timestamp: number;                                         // 时间戳
  reasons?: string[];                                        // 风险原因
}
```

拒绝（403）:
```typescript
{
  success: false;
  decision: 'reject';
  timestamp: number;
  reasons: string[];                                         // 拒绝原因
  error: {
    code: 'RISK_REJECTED';
    message: '提现被风控拒绝';
    details: string;                                         // 详细原因
  }
}
```

- **查询 API**: `GET /api/assessment/:operation_id`
  - 根据 operation_id 查询风控评估结果


### 2. 查看待审核列表
```bash
GET http://localhost:3004/api/pending-reviews
```

### 审核员批准接口

```bash
POST http://localhost:3004/api/manual-review
{
  "operation_id": "uuid-xxxx",
  "approver_user_id": 1,
  "approved": true,
  "comment": "Verified user identity"
}
```

审核完成后自动回调 Wallet 服务 POST `ttp://localhost:3001/api/internal/manual-review-callback`

## 风控规则

已实现风控规则：黑名单控制， 未来考虑加入：

1. **大额提现**: 超过阈值的提现需要人工审核
2. **频繁提现**: 短时间内多次提现
3. **新地址提现**: 向未知地址提现
4. **Credit操作**: 大额余额变更

  
 

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

 