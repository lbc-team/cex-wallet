# 风控系统设计与实现文档

## 目录
- [1. 概述](#1-概述)
- [2. 数据库设计](#2-数据库设计)
- [3. 系统架构](#3-系统架构)
- [4. 工作流程](#4-工作流程)
- [5. API 接口](#5-api-接口)
- [6. Wallet 后台任务](#6-wallet-后台任务)
- [7. 提现流程集成](#7-提现流程集成)
- [8. 部署与配置](#8-部署与配置)

---

## 1. 概述

风控系统是一个独立的微服务，负责对钱包系统的关键操作（如提现、充值等）进行风险评估和人工审核。

1. **自动风控评估**：基于规则引擎自动评估操作风险
2. **人工审核**：高风险操作需要人工审核批准
3. **黑名单管理**：管理风险地址黑名单

### 1.1 技术栈

- **语言**: TypeScript
- **运行时**: Node.js
- **框架**: Express.js
- **数据库**: SQLite (risk_control.db)
- **签名**: Ed25519 

---

## 2. 数据库设计

### 2.1 risk_assessments (风控评估记录表)

存储所有风控评估记录，包括自动批准、人工审核、拒绝等。

```sql
CREATE TABLE risk_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT UNIQUE NOT NULL,     -- 操作ID (由业务层生成的UUID)
  table_name TEXT NOT NULL,              -- 业务表名 (withdrawals/credits)
  record_id INTEGER,                     -- 业务表记录ID (双向关联)
  action TEXT NOT NULL,                  -- 操作类型 (insert/update/delete)
  user_id INTEGER,                       -- 关联用户ID

  -- 操作数据
  operation_data TEXT NOT NULL,          -- JSON: 原始操作数据
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

---

## 3. 系统架构

### 3.1 服务架构

```
┌─────────────┐      ┌─────────────┐
│   Wallet    │      │ Risk Control│
│  Service    │      │   Service   │
│  :3001      │      │   :3004     │
└──────┬──────┘      └──────┬──────┘
       │                    │
       │  1. 请求风控评估    │
       │───────────────────>│
       │                    │
       │  2. 返回风控结果    │
       │<───────────────────│
       │                    │
       │  3. 如果自动批准，直接执行
       │                    │
       │  4. 如果需要审核，等待
       │                    │
       │  5. Wallet 后台任务轮询已批准的 operation_id
       │                    │
       │  6. 查询风控状态    │
       │───────────────────>│
       │                    │
       │  7. 返回已批准      │
       │<───────────────────│
       │                    │
       │  8. 继续执行操作    │
```

**关键设计**：
- ✅ Wallet 服务主动轮询风控结果（而不是风控服务推送）
- ✅ Wallet 服务控制执行时机
- ✅ 风控服务只提供查询接口

### 3.2 核心模块

#### 3.2.1 RiskAssessmentService (风控评估服务)

负责评估操作风险，应用风控规则。

**主要功能**：
- 检查黑名单地址
- 检查高风险用户
- 检查大额交易
- 检查敏感操作
- 返回风控决策

**风控规则**（按优先级）：
```typescript
1. 黑名单地址          → deny (critical)
2. 高风险用户          → manual_review (high)
3. 大额交易            → manual_review (high)
4. 敏感操作            → manual_review (medium)
5. 默认                → approve (low)
```

#### 3.2.2 ManualReviewService (人工审核服务)

处理人工审核相关的业务逻辑。

**主要功能**：
- 提交审核结果
- 查询待审核列表
- 查询审核历史


## 4. 工作流程

### 4.1 自动批准流程（低风险）

```
用户发起提现
    ↓
wallet 服务调用风控评估
    ↓
风控服务评估（未触发任何规则）
    ↓
返回 decision: approve
    ↓
wallet 服务直接执行提现
    ↓
完成
```

### 4.2 人工审核流程（中高风险）

```
用户发起提现
    ↓
wallet 服务调用风控评估
    ↓
风控服务评估（触发大额交易规则）
    ↓
返回 decision: manual_review
    ↓
wallet 服务创建提现记录，状态: pending_review
    ↓
用户看到"等待审核"提示
    ↓
审核员登录审核系统
    ↓
审核员查看待审核列表（调用风控服务 API）
    ↓
审核员审核并批准/拒绝
    ↓
风控服务更新 approval_status = 'approved'
    ↓
wallet 后台任务检测到已批准操作
    ↓
wallet 服务继续执行提现
    ↓
完成
```

### 4.3 直接拒绝流程（黑名单）

```
用户发起提现到黑名单地址
    ↓
wallet 服务调用风控评估
    ↓
风控服务检测到黑名单地址
    ↓
返回 decision: deny
    ↓
wallet 服务拒绝提现
    ↓
返回错误给用户（可能包含建议）
```

---

## 5. API 接口

### 5.1 POST /api/assess (风控评估)

**请求**：
```json
{
  "operation_id": "uuid-xxx",
  "operation_type": "write",
  "table": "withdrawals",
  "action": "insert",
  "data": {
    "user_id": 123,
    "to_address": "0x...",
    "amount": "1000000000000000000"
  },
  "timestamp": 1234567890,
  "context": {
    "user_id": 123,
    "amount": "1000000000000000000",
    "to_address": "0x...",
    "chain_type": "evm"
  }
}
```

**响应**（自动批准）：
```json
{
  "success": true,
  "decision": "approve",
  "operation_id": "uuid-xxx",
  "db_operation": { ... },
  "risk_signature": "...",
  "timestamp": 1234567890,
  "risk_level": "low",
  "reasons": ["Normal transaction"]
}
```

**响应**（需要人工审核）：
```json
{
  "success": true,
  "decision": "manual_review",
  "operation_id": "uuid-xxx",
  "db_operation": { ... },
  "suggest_operation_data": {
    "user_id": 123,
    "to_address": "0x...",
    "amount": "5000000000000000000"
  },
  "suggest_reason": "建议金额过大，建议分批提现，单次建议金额: 5000000000000000000",
  "risk_signature": "...",
  "timestamp": 1234567890,
  "risk_level": "high",
  "reasons": ["Large amount transaction: 10000000000000000000", "Manual review required"]
}
```

**响应**（拒绝，但提供建议）：
```json
{
  "success": false,
  "decision": "deny",
  "operation_id": "uuid-xxx",
  "db_operation": {
    "table": "withdrawals",
    "action": "insert",
    "data": {
      "user_id": 123,
      "to_address": "0x...",
      "amount": "5000000000000000000"
    }
  },
  "suggest_operation_data": {
    "user_id": 123,
    "to_address": "0x...",
    "amount": "5000000000000000000"
  },
  "suggest_reason": "建议金额过大，建议分批提现，单次建议金额: 5000000000000000000",
  "risk_signature": "...",
  "timestamp": 1234567890,
  "risk_level": "critical",
  "reasons": ["To address is blacklisted: Known scammer"],
  "error": {
    "code": "RISK_CONTROL_REJECTED",
    "message": "Operation rejected by risk control",
    "details": ["To address is blacklisted: Known scammer"]
  }
}
```

### 5.2 POST /api/manual-review (提交人工审核)

**请求**：
```json
{
  "operation_id": "uuid-xxx",
  "approver_user_id": 999,
  "approver_username": "admin",
  "approved": true,
  "comment": "核实用户身份，允许提现"
}
```

**响应**：
```json
{
  "success": true,
  "message": "Operation approved successfully",
  "operation_id": "uuid-xxx",
  "approval_status": "approved"
}
```

### 5.3 GET /api/pending-reviews (获取待审核列表)

**请求**：
```
GET /api/pending-reviews?limit=50
```

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "operation_id": "uuid-xxx",
      "table_name": "withdrawals",
      "action": "insert",
      "user_id": 123,
      "operation_data": {
        "to_address": "0x...",
        "amount": "10000000000000000000"
      },
      "risk_level": "high",
      "reasons": ["Large amount transaction", "Manual review required"],
      "created_at": "2025-10-05T10:00:00.000Z"
    }
  ]
}
```

### 5.4 建议数据使用说明

风控服务可以在任何决策（`approve`、`manual_review`、`deny`）中提供建议数据 `suggest_operation_data`。

**使用场景**：

1. **大额提现建议分批**：
   - 用户请求：提现 10000 USDT
   - 风控建议：单次提现 5000 USDT
   - 决策：`manual_review` 或 `deny`

2. **修改提现地址**：
   - 用户请求：提现到黑名单地址
   - 风控建议：提现到白名单地址
   - 决策：`deny`

3. **调整手续费**：
   - 用户请求：低手续费提现
   - 风控建议：提高手续费以加快处理
   - 决策：`approve`

**业务层使用建议数据**：

```typescript
// wallet/src/services/walletBusinessService.ts

async withdrawFunds(params) {
  const riskResult = await riskControlClient.requestRiskAssessment({ ... });

  if (riskResult.decision === 'deny') {
    // 检查是否有建议数据
    if (riskResult.suggest_operation_data) {
      return {
        success: false,
        error: '提现被风控拒绝',
        suggestion: {
          data: riskResult.suggest_operation_data,
          reason: riskResult.suggest_reason,
          message: '您可以按照建议的金额重新提现'
        }
      };
    }

    return {
      success: false,
      error: '提现被风控拒绝: ' + riskResult.reasons?.join(', ')
    };
  }

  // 如果有建议数据，可以选择使用（例如自动调整）
  const finalData = riskResult.suggest_operation_data || params;

  // 继续执行提现...
}
```

**前端展示建议**：

```typescript
// 前端代码
const response = await api.withdraw({ amount: '10000', ... });

if (!response.success && response.suggestion) {
  // 展示建议给用户
  showSuggestion({
    title: '建议修改',
    message: response.suggestion.reason,
    suggestedAmount: response.suggestion.data.amount,
    onAccept: () => {
      // 使用建议金额重新提现
      api.withdraw(response.suggestion.data);
    }
  });
}
```

### 5.5 GET /api/review-history/:operation_id (获取审核历史)

**请求**：
```
GET /api/review-history/uuid-xxx
```

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "operation_id": "uuid-xxx",
      "approver_user_id": 999,
      "approver_username": "admin",
      "approved": true,
      "comment": "核实用户身份，允许提现",
      "created_at": "2025-10-05T10:05:00.000Z"
    }
  ]
}
```

---

## 6. Wallet 后台任务

### 6.1 ProcessApprovedWithdrawals (放在 wallet 服务中)

**功能**: 定时处理已审核通过的提现操作

**执行频率**: 每 10 秒

**工作流程**:
1. 从 wallet.db 查询 `status = 'pending_review'` 的提现记录
2. 获取这些记录的 `operation_id` 列表
3. 批量查询风控服务，检查 `approval_status`
4. 对于 `approval_status = 'approved'` 的记录，继续执行提现
5. 对于 `approval_status = 'rejected'` 的记录，更新状态为 `rejected`

**示例代码**（wallet 服务）:
```typescript
// wallet/src/jobs/process-approved-withdrawals.ts

export class ProcessApprovedWithdrawalsJob {
  async process() {
    // 1. 查询等待审核的提现
    const pendingWithdrawals = await db.query(`
      SELECT * FROM withdrawals
      WHERE status = 'pending_review'
      AND operation_id IS NOT NULL
    `);

    if (pendingWithdrawals.length === 0) return;

    // 2. 批量查询风控状态
    for (const withdrawal of pendingWithdrawals) {
      try {
        const riskStatus = await riskControlClient.getAssessmentStatus(
          withdrawal.operation_id
        );

        if (riskStatus.approval_status === 'approved') {
          // 3. 继续执行提现
          await this.continueWithdrawal(withdrawal);
        } else if (riskStatus.approval_status === 'rejected') {
          // 4. 更新为拒绝
          await db.update('withdrawals', withdrawal.id, {
            status: 'rejected',
            error_message: '审核未通过'
          });
        }
      } catch (error) {
        logger.error('Failed to process withdrawal', { error, withdrawal });
      }
    }
  }

  private async continueWithdrawal(withdrawal: any) {
    // 选择热钱包、签名、发送交易等
    // ... 原来的提现逻辑 ...
  }
}
```

### 6.2 风控服务需要添加的查询接口

```typescript
// risk_control/src/controllers/risk.ts

/**
 * 查询评估状态
 */
getAssessmentStatus = async (req: Request, res: Response) => {
  const { operation_id } = req.params;

  const assessment = this.riskService
    .getAssessmentModel()
    .findByOperationId(operation_id);

  if (!assessment) {
    return res.status(404).json({
      success: false,
      error: 'Assessment not found'
    });
  }

  return res.json({
    success: true,
    data: {
      operation_id: assessment.operation_id,
      decision: assessment.decision,
      approval_status: assessment.approval_status,
      risk_level: assessment.risk_level
    }
  });
};
```

---

## 7. 提现流程集成

### 7.1 wallet 服务修改

#### 7.1.1 在 withdrawFunds 中集成风控

```typescript
// 在 wallet/src/services/walletBusinessService.ts

async withdrawFunds(params) {
  // 1. 生成 operation_id
  const operationId = uuid();

  // 2. 调用风控评估
  const riskResult = await riskControlClient.requestRiskAssessment({
    operation_id: operationId,
    operation_type: 'write',
    table: 'withdrawals',
    action: 'insert',
    data: {
      user_id: params.userId,
      to_address: params.to,
      amount: requestedAmountBigInt.toString()
    },
    timestamp: Date.now(),
    context: {
      user_id: params.userId,
      amount: requestedAmountBigInt.toString(),
      to_address: params.to,
      chain_type: params.chainType
    }
  });

  // 3. 根据风控决策处理
  if (riskResult.decision === 'deny') {
    return {
      success: false,
      error: '提现被风控拒绝: ' + riskResult.reasons?.join(', ')
    };
  }

  if (riskResult.decision === 'manual_review') {
    // 3.1 创建提现记录（状态: pending_review）
    const withdrawId = await this.dbGatewayClient.createWithdrawRequest({
      user_id: params.userId,
      to_address: params.to,
      amount: requestedAmountBigInt.toString(),
      fee: withdrawFee,
      chain_id: params.chainId,
      chain_type: params.chainType,
      status: 'pending_review',
      operation_id: operationId  // 关联风控记录
    });

    // 3.2 更新风控记录的 record_id
    await riskControlClient.updateRecordId(operationId, withdrawId);

    return {
      success: true,
      data: {
        withdrawId,
        status: 'pending_review',
        message: '提现金额较大，需要人工审核，请等待审核结果'
      }
    };
  }

  // 4. 自动批准，创建提现记录并继续执行
  const withdrawId = await this.dbGatewayClient.createWithdrawRequest({
    user_id: params.userId,
    to_address: params.to,
    amount: requestedAmountBigInt.toString(),
    fee: withdrawFee,
    chain_id: params.chainId,
    chain_type: params.chainType,
    status: 'pending',
    operation_id: operationId
  });

  // 5. 继续执行提现流程
  // ... 原来的提现逻辑 ...
}
```

### 7.2 完整流程时序图

```
用户              Wallet服务         Risk Control        后台任务          审核员
 │                   │                    │                 │               │
 │  发起提现          │                    │                 │               │
 │─────────────────>│                    │                 │               │
 │                  │                    │                 │               │
 │                  │  请求风控评估       │                 │               │
 │                  │─────────────────>│                 │               │
 │                  │                    │                 │               │
 │                  │  返回: manual_review│                 │               │
 │                  │<─────────────────│                 │               │
 │                  │                    │                 │               │
 │                  │  创建提现记录(pending_review)         │               │
 │                  │                    │                 │               │
 │  返回: 等待审核   │                    │                 │               │
 │<─────────────────│                    │                 │               │
 │                  │                    │                 │               │
 │                  │                    │                 │  查看待审核列表 │
 │                  │                    │<───────────────────────────────│
 │                  │                    │                 │               │
 │                  │                    │  提交审核结果   │               │
 │                  │                    │<───────────────────────────────│
 │                  │                    │                 │               │
 │                  │                    │  更新审批状态   │               │
 │                  │                    │                 │               │
 │                  │                    │  轮询pending_review提现         │
 │                  │                    │                 │               │
 │                  │  查询风控状态       │                 │               │
 │                  │─────────────────>│                 │               │
 │                  │                    │                 │               │
 │                  │  返回: approved     │                 │               │
 │                  │<─────────────────│                 │               │
 │                  │                    │                 │               │
 │                  │  继续执行提现      │                 │               │
 │                  │                    │                 │               │
 │  提现成功         │                    │                 │               │
 │<─────────────────│                    │                 │               │
```

---

## 8. 部署与配置

### 8.1 环境变量

创建 `risk_control/.env` 文件：

```bash
# 服务端口
PORT=3004

# 风控私钥（Ed25519）
RISK_PRIVATE_KEY=your_private_key_here

# 数据库路径（可选，默认 risk_control.db）
DB_PATH=data/risk_control.db

# 日志级别
LOG_LEVEL=info

# 环境
NODE_ENV=development
```

### 8.2 启动服务

```bash
# 安装依赖
cd risk_control
npm install

# 生成密钥对（首次部署）
npm run generate-keypair

# 启动服务
npm run dev

# 生产环境
npm run build
npm start
```

### 8.3 初始化黑名单数据

```sql
-- 添加测试黑名单地址
INSERT INTO address_risk_list (address, chain_type, risk_type, risk_level, reason, source, enabled)
VALUES
  ('0xblacklist001', 'evm', 'blacklist', 'high', 'Known scammer', 'manual', 1),
  ('0xblacklist002', 'evm', 'blacklist', 'high', 'Money laundering', 'manual', 1);
```

### 8.4 监控与维护

#### 8.4.1 日志监控

日志文件位置: `risk_control/logs/`

监控关键指标:
- 风控评估数量
- 人工审核数量
- 拒绝率
- 响应时间

#### 8.4.2 数据库维护

定期清理:
```sql
-- 清理 30 天前的评估记录
DELETE FROM risk_assessments
WHERE created_at < datetime('now', '-30 days')
AND approval_status IN ('approved', 'rejected');

-- 清理过期的未处理记录
UPDATE risk_assessments
SET approval_status = 'rejected'
WHERE expires_at < datetime('now')
AND approval_status = 'pending';
```

---

## 9. 总结

本文档详细介绍了风控系统的设计与实现，包括：

1. ✅ **独立数据库设计**：使用 `risk_control.db` 存储风控数据
2. ✅ **双向关联**：通过 `operation_id` 和 `record_id` 实现业务数据和风控数据的关联
3. ✅ **人工审核流程**：完整的审核提交、查询流程
4. ✅ **职责分离**：风控服务只评估，wallet 服务负责执行
5. ✅ **后台任务在 wallet**：由业务服务主动查询和执行

### 关键优势

- **职责清晰**：风控服务只负责评估，不参与业务执行
- **解耦合**：服务之间通过 operation_id 松耦合
- **可扩展性**：易于添加新的风控规则和审核流程
- **可追溯性**：完整的审计日志
- **高可用性**：独立服务，互不影响

### 建议数据的核心价值

1. **提升用户体验**：
   - 不是简单拒绝，而是给出具体建议
   - 用户可以根据建议调整请求
   - 减少用户困惑和不满

2. **灵活的风控策略**：
   - 风控可以给出"有条件批准"
   - 例如：金额太大就建议分批
   - 例如：地址有风险就建议换地址

3. **自动化优化**：
   - 业务层可以自动采纳建议
   - 减少人工干预
   - 提升处理效率

4. **数据驱动决策**：
   - 记录用户是否采纳建议
   - 分析建议采纳率
   - 优化风控规则

### 后续优化方向

1. **规则引擎增强**：支持动态配置风控规则
2. **机器学习**：引入 ML 模型进行风险预测
3. **多级审核**：支持多人审核、审核流程配置
4. **实时监控**：添加实时监控告警
5. **批量查询优化**：wallet 后台任务批量查询风控状态
6. **智能建议**：基于历史数据优化建议策略
