# 风控模块

提升系统整体的安全性， 主要的目标是防止盗币、欺诈、洗钱与以及内部作恶。而且需要在尽量不破坏用户体验下拦截高风险行为。

## 设计更新，

我们当前的设计上，其实是**存在一些安全风险的**：例如 wallet 和 scan 模块都直接读写数据库，缺乏统一权限控制，很可能出现开发人员可以绕过业务逻辑直接修改敏感数据。

我们可以考虑添加一个数据库网关，网关单独部署，经允许内网服务访问。
并且对数据库读写安排不同的访问权限：



![数据库网关](https://img.learnblockchain.cn/pics/20250930163609.png)

签名机数据库保持不变， 确保私钥只存在自己的本机，外部不能访问，业务层数据库根据读写权限不同，做不同的控制：

1. 

Wallet 模块和 scan 模块



读操作： 

- Level 1: 读操作（模块身份验证）
- Level 2: 写操作（模块签名）, block 表、Nonce 表 
- Level 3: 敏感操作（业务签名 + 风控评估） 流水表


提现操作修改一下， 修改为， 通过风控的提现请求， 消息队列


存款： 
scan(写 credits )  
风控给出操作建议，并签名， 业务层再次签名

UUID ， 防止签名重放



各模块职责清晰分离，





  1. 权限管理:



**Level 1 - 读操作**
- 权限要求：模块身份验证
- 适用操作：查询用户余额、钱包信息、交易记录等
- 签名要求：模块身份Token
- 适用模块：Wallet、Scan

**Level 2 - 一般写操作**
- 权限要求：业务模块签名
- 适用操作：区块链扫描数据录入、钱包状态更新等
- 签名要求：业务模块签名
- 适用模块：Scan（充值检测）、Wallet（非敏感更新）

**Level 3 - 敏感操作**
- 权限要求：业务 + 风控双重签名
- 适用操作：用户余额变更、提现处理、热钱包操作
- 签名要求：业务签名 + 风控签名
- 适用模块：Wallet（提现、余额调整）

- 无法有效防范内部作恶行为

## 多重校验

- 敏感操作（如提现）缺乏有效的多重验证


保证可审计、可回溯、可响应、并满足监管合规。


 权限分级: 读操作、写操作、敏感操作的三级权限管理


（时间戳验证）

RS256 与 Ed25519 签名验签



-   3. 风控系统:
    - 大额提现自动检测
    - 频繁操作模式识别
    - 可配置风控规则
    - 自动/人工审批决策


有效防止内部作恶并提供完整的操作审计



🎯 新架构设计

  核心思路：风控前置 + 双签名机制

  ┌─────────┐    ┌─────────┐
  │ wallet  │    │  scan   │
  └────┬────┘    └────┬────┘
       │              │
       │  ①请求风控评估
       ├──────┬───────┤
       │      │       │
       ▼      ▼       ▼
  ┌─────────────────────┐
  │  risk_control       │ ← 与业务层同级
  │  (风控服务)         │
  └─────────┬───────────┘
            │ ②返回风控签名
            │
       ┌────┴────┐
       │         │
       ▼         ▼
  ┌─────────┐ ┌─────────┐
  │ wallet  │ │  scan   │
  └────┬────┘ └────┬────┘
       │            │
       │ ③带双签名请求
       ├────────┬───┤
       │        │   │
       ▼        ▼   ▼
  ┌─────────────────────┐
  │    db_gateway       │ ← 验证双签名
  │  (Database API)     │
  └─────────┬───────────┘
            │
            ▼
      ┌─────────┐
      │业务数据库│ ← 所有服务共享同一个数据库
      └─────────┘

  ---
  ✅ 这种设计的优势

  1. 安全性更高

  - 双签名验证：敏感操作必须同时有 business_signature + risk_control_signature
  - 职责分离：即使业务系统被攻破，没有风控签名也无法执行敏感操作
  - 风控前置：在数据写入前就进行风控检查，避免脏数据

  2. 性能更好

  - 减少数据传输：risk_control 直接访问数据库，可以查询历史数据做更精准的风控
  - 无需数据同步：共享数据库，无需维护数据一致性

  3. 架构更清晰

  - 明确的调用链：业务层 → 风控层 → 数据层
  - 职责明确：
    - wallet/scan：业务逻辑 + 业务签名
    - risk_control：风控评估 + 风控签名
    - db_gateway：数据操作 + 双签名验证

  4. 灵活性强

  - 可选风控：read/write 操作可以不需要风控签名，只有 sensitive 操作需要
  - 风控升级：可以独立升级风控规则，不影响业务系统
  - 审计完整：所有敏感操作都有完整的审批记录

  ---
  📊 数据库设计（共享数据库）

  在现有的 wallet.db 中添加风控相关表

  1. 风控规则表 (risk_rules)

  CREATE TABLE risk_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    table_name TEXT NOT NULL,          -- withdraws, credits, etc.
    rule_type TEXT NOT NULL,           -- amount_threshold, frequency, blacklist, user_behavior
    conditions TEXT NOT NULL,          -- JSON: 规则条件
    risk_weight INTEGER NOT NULL,      -- 风险权重 0-100
    enabled INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX idx_risk_rules_table ON risk_rules(table_name);
  CREATE INDEX idx_risk_rules_enabled ON risk_rules(enabled);

  2. 风控评估记录表 (risk_assessments)

  CREATE TABLE risk_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT UNIQUE NOT NULL,     -- 操作ID (UUID)
    module TEXT NOT NULL,                  -- wallet/scan
    table_name TEXT NOT NULL,
    action TEXT NOT NULL,
    user_id INTEGER,                       -- 关联用户
    operation_data TEXT,                   -- JSON: 操作数据摘要
    risk_score INTEGER NOT NULL,
    risk_level TEXT NOT NULL,              -- low/medium/high
    decision TEXT NOT NULL,                -- auto_approve/manual_review/deny
    triggered_rules TEXT,                  -- JSON: 触发的规则ID数组
    reasons TEXT,                          -- JSON: 风险原因数组
    required_approvals INTEGER DEFAULT 0,
    current_approvals INTEGER DEFAULT 0,
    approval_status TEXT DEFAULT 'pending',-- pending/approved/rejected/expired
    risk_signature TEXT,                   -- 风控签名
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX idx_risk_assessments_operation ON risk_assessments(operation_id);
  CREATE INDEX idx_risk_assessments_user ON risk_assessments(user_id);
  CREATE INDEX idx_risk_assessments_status ON risk_assessments(approval_status);
  CREATE INDEX idx_risk_assessments_decision ON risk_assessments(decision);
  CREATE INDEX idx_risk_assessments_expires ON risk_assessments(expires_at);
  CREATE INDEX idx_risk_assessments_created ON risk_assessments(created_at);

  3. 人工审批记录表 (risk_approvals)

  CREATE TABLE risk_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL,
    operation_id TEXT NOT NULL,
    approver_user_id INTEGER NOT NULL,
    approver_username TEXT,
    approved INTEGER NOT NULL,             -- 0=拒绝, 1=批准
    comment TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assessment_id) REFERENCES risk_assessments(id),
    FOREIGN KEY (approver_user_id) REFERENCES users(id)
  );

  CREATE INDEX idx_risk_approvals_assessment ON risk_approvals(assessment_id);
  CREATE INDEX idx_risk_approvals_operation ON risk_approvals(operation_id);
  CREATE INDEX idx_risk_approvals_approver ON risk_approvals(approver_user_id);

  4. 用户风险画像表 (user_risk_profiles)

  CREATE TABLE user_risk_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    total_operations INTEGER DEFAULT 0,        -- 总操作次数
    total_withdraws INTEGER DEFAULT 0,
    total_withdraw_amount TEXT DEFAULT '0',    -- 累计提现金额（最小单位）
    last_withdraw_at DATETIME,
    withdraw_24h_count INTEGER DEFAULT 0,      -- 24小时内提现次数
    withdraw_24h_amount TEXT DEFAULT '0',      -- 24小时内提现金额
    high_risk_operations INTEGER DEFAULT 0,    -- 高风险操作次数
    denied_operations INTEGER DEFAULT 0,       -- 被拒绝次数
    blacklisted INTEGER DEFAULT 0,             -- 0=正常, 1=黑名单
    whitelist_level INTEGER DEFAULT 0,         -- 白名单级别 0-5
    trust_score INTEGER DEFAULT 50,            -- 信任分数 0-100
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX idx_user_risk_profiles_user ON user_risk_profiles(user_id);
  CREATE INDEX idx_user_risk_profiles_blacklist ON user_risk_profiles(blacklisted);
  CREATE INDEX idx_user_risk_profiles_trust ON user_risk_profiles(trust_score);

  5. 地址风险表 (address_risk_list)

  CREATE TABLE address_risk_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT UNIQUE NOT NULL,
    chain_type TEXT NOT NULL,              -- evm, btc, solana
    risk_type TEXT NOT NULL,               -- blacklist/whitelist/suspicious/sanctioned
    risk_level TEXT DEFAULT 'medium',      -- low/medium/high
    reason TEXT,
    source TEXT DEFAULT 'manual',          -- manual/auto/chainalysis/ofac
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX idx_address_risk_address ON address_risk_list(address);
  CREATE INDEX idx_address_risk_type ON address_risk_list(risk_type);
  CREATE INDEX idx_address_risk_enabled ON address_risk_list(enabled);

  6. 风控操作日志表 (risk_operation_logs)

  CREATE TABLE risk_operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL,
    assessment_id INTEGER,
    event_type TEXT NOT NULL,              -- assess/approve/reject/execute/expire
    event_data TEXT,                       -- JSON: 事件数据
    operator TEXT,                         -- 操作者 (system/user_id)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assessment_id) REFERENCES risk_assessments(id)
  );

  CREATE INDEX idx_risk_logs_operation ON risk_operation_logs(operation_id);
  CREATE INDEX idx_risk_logs_assessment ON risk_operation_logs(assessment_id);
  CREATE INDEX idx_risk_logs_event ON risk_operation_logs(event_type);
  CREATE INDEX idx_risk_logs_created ON risk_operation_logs(created_at);

  ---
  🔄 完整流程设计

  场景：用户提现（敏感操作）

  Step 1: 业务层发起风控评估请求

  // wallet/src/services/withdrawService.ts

  async createWithdraw(params: WithdrawParams) {
    // 1. 先请求风控评估
    const riskAssessment = await this.requestRiskControl({
      operation_id: uuidv4(),
      operation_type: 'sensitive',
      table: 'withdraws',
      action: 'insert',
      data: {
        user_id: params.userId,
        to_address: params.toAddress,
        amount: params.amount,
        token_id: params.tokenId,
        chain_id: params.chainId
      }
    });

    // 2. 根据风控决策处理
    if (riskAssessment.decision === 'deny') {
      throw new Error(`Operation denied: ${riskAssessment.reasons.join(', ')}`);
    }

    if (riskAssessment.decision === 'manual_review') {
      // 等待人工审批
      return {
        status: 'pending_approval',
        operation_id: riskAssessment.operation_id,
        message: `Requires manual approval: ${riskAssessment.reasons.join(', ')}`,
        expires_at: riskAssessment.expires_at
      };
    }

    // 3. 风控通过，获取风控签名，执行数据库操作
    const result = await this.dbGateway.executeWithRiskSignature({
      operation_id: riskAssessment.operation_id,
      operation_type: 'sensitive',
      table: 'withdraws',
      action: 'insert',
      data: params,
      business_signature: this.signer.sign(...),
      risk_control_signature: riskAssessment.risk_signature  // 风控签名
    });

    return result;
  }

  Step 2: risk_control 服务处理评估请求

  // risk_control/src/controllers/assessment.ts

  async evaluate(req: Request, res: Response) {
    const request = req.body;

    // 1. 查询用户风险画像
    const userProfile = await this.db.getUserRiskProfile(request.data.user_id);

    // 2. 查询地址风险（如果是提现）
    let addressRisk = null;
    if (request.table === 'withdraws' && request.data.to_address) {
      addressRisk = await this.db.getAddressRisk(request.data.to_address);
    }

    // 3. 查询用户最近的操作频率
    const recentOps = await this.db.getRecentOperations(
      request.data.user_id,
      request.table,
      24 // 24小时内
    );

    // 4. 应用所有风控规则
    const rules = await this.db.getActiveRules(request.table);
    let totalScore = 0;
    const triggeredRules: string[] = [];
    const reasons: string[] = [];

    for (const rule of rules) {
      const result = await this.ruleEvaluator.evaluate(rule, {
        request,
        userProfile,
        addressRisk,
        recentOps
      });

      if (result.triggered) {
        totalScore += rule.risk_weight;
        triggeredRules.push(rule.id);
        reasons.push(result.reason);
      }
    }

    // 5. 计算风险等级和决策
    const assessment = this.calculateAssessment(totalScore, triggeredRules, reasons);

    // 6. 如果通过，生成风控签名
    let riskSignature = null;
    if (assessment.decision === 'auto_approve') {
      riskSignature = this.signer.sign({
        operation_id: request.operation_id,
        decision: assessment.decision,
        risk_score: assessment.risk_score,
        timestamp: Date.now()
      });
    }

    // 7. 保存评估记录
    await this.db.saveAssessment({
      operation_id: request.operation_id,
      module: request.module,
      table_name: request.table,
      action: request.action,
      user_id: request.data.user_id,
      operation_data: JSON.stringify(request.data),
      risk_score: assessment.risk_score,
      risk_level: assessment.risk_level,
      decision: assessment.decision,
      triggered_rules: JSON.stringify(triggeredRules),
      reasons: JSON.stringify(reasons),
      required_approvals: assessment.required_approvals,
      risk_signature: riskSignature,
      expires_at: assessment.expires_at
    });

    // 8. 记录日志
    await this.db.logRiskOperation({
      operation_id: request.operation_id,
      event_type: 'assess',
      event_data: JSON.stringify(assessment),
      operator: 'system'
    });

    // 9. 更新用户风险画像
    await this.db.updateUserRiskProfile(request.data.user_id, {
      total_operations: userProfile.total_operations + 1,
      high_risk_operations: assessment.risk_level === 'high'
        ? userProfile.high_risk_operations + 1
        : userProfile.high_risk_operations
    });

    res.json({
      success: true,
      assessment: {
        ...assessment,
        risk_signature: riskSignature
      }
    });
  }

  Step 3: db_gateway 验证双签名

  // db_gateway/src/middleware/signature.ts

  verifyRiskControlSignature = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const gatewayRequest = req.gatewayRequest!;

    // 只有 sensitive 操作需要风控签名
    if (gatewayRequest.operation_type !== 'sensitive') {
      next();
      return;
    }

    // 检查是否有风控签名
    if (!gatewayRequest.risk_control_signature) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'MISSING_RISK_SIGNATURE',
          message: 'Sensitive operation requires risk control signature'
        }
      });
    }

    // 验证风控签名
    const verifier = new Ed25519Verifier();
    const isValid = verifier.verify(
      {
        operation_id: gatewayRequest.operation_id,
        decision: 'auto_approve',  // 只有 auto_approve 才有签名
        timestamp: gatewayRequest.timestamp
      },
      gatewayRequest.risk_control_signature,
      'risk_control'  // 使用 risk_control 的公钥
    );

    if (!isValid) {
      logger.warn('Invalid risk control signature', {
        operation_id: gatewayRequest.operation_id
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'INVALID_RISK_SIGNATURE',
          message: 'Risk control signature verification failed'
        }
      });
    }

    logger.info('Risk control signature verified', {
      operation_id: gatewayRequest.operation_id
    });

    next();
  };

  Step 4: 人工审批流程

  // risk_control/src/controllers/approval.ts

  async approve(req: Request, res: Response) {
    const { operation_id, approver_user_id, approved, comment } = req.body;

    // 1. 查询评估记录
    const assessment = await this.db.getAssessmentByOperationId(operation_id);

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Assessment not found' }
      });
    }

    // 2. 检查是否已过期
    if (new Date(assessment.expires_at) < new Date()) {
      await this.db.updateAssessmentStatus(assessment.id, 'expired');
      return res.status(400).json({
        success: false,
        error: { code: 'EXPIRED', message: 'Assessment has expired' }
      });
    }

    // 3. 记录审批
    await this.db.createApproval({
      assessment_id: assessment.id,
      operation_id,
      approver_user_id,
      approver_username: req.user?.username,
      approved: approved ? 1 : 0,
      comment,
      ip_address: req.ip
    });

    // 4. 更新审批状态
    const currentApprovals = assessment.current_approvals + (approved ? 1 : 0);
    const approvalStatus = approved
      ? (currentApprovals >= assessment.required_approvals ? 'approved' : 'pending')
      : 'rejected';

    await this.db.updateAssessment(assessment.id, {
      current_approvals: currentApprovals,
      approval_status: approvalStatus
    });

    // 5. 如果审批通过，生成风控签名
    let riskSignature = null;
    if (approvalStatus === 'approved') {
      riskSignature = this.signer.sign({
        operation_id,
        decision: 'approved',
        risk_score: assessment.risk_score,
        timestamp: Date.now()
      });

      await this.db.updateAssessmentSignature(assessment.id, riskSignature);
    }

    // 6. 记录日志
    await this.db.logRiskOperation({
      operation_id,
      assessment_id: assessment.id,
      event_type: approved ? 'approve' : 'reject',
      event_data: JSON.stringify({ approver_user_id, comment }),
      operator: `user_${approver_user_id}`
    });

    // 7. 更新用户风险画像
    if (!approved) {
      await this.db.incrementDeniedOperations(assessment.user_id);
    }

    res.json({
      success: true,
      message: approved ? 'Operation approved' : 'Operation rejected',
      assessment: {
        operation_id,
        approval_status: approvalStatus,
        current_approvals: currentApprovals,
        required_approvals: assessment.required_approvals,
        risk_signature: riskSignature
      }
    });
  }

  ---
  🔧 API 设计

  risk_control 服务 API

  1. 风控评估 API

  POST /api/risk/evaluate
  X-Signature: <business_signature>  // 业务层签名，确保请求来自 wallet/scan

  Request:
  {
    "operation_id": "uuid",
    "operation_type": "sensitive",
    "module": "wallet",
    "table": "withdraws",
    "action": "insert",
    "data": {
      "user_id": 123,
      "to_address": "0xabc...",
      "amount": "50000000000000000000000",
      "token_id": 1,
      "chain_id": 31337
    },
    "timestamp": 1727700000000
  }

  Response (自动通过):
  {
    "success": true,
    "assessment": {
      "operation_id": "uuid",
      "risk_score": 25,
      "risk_level": "low",
      "decision": "auto_approve",
      "reasons": ["Low risk operation"],
      "required_approvals": 0,
      "risk_signature": "风控签名hex字符串"
    }
  }

  Response (需要审批):
  {
    "success": true,
    "assessment": {
      "operation_id": "uuid",
      "risk_score": 65,
      "risk_level": "medium",
      "decision": "manual_review",
      "reasons": ["Large amount withdrawal: 50000 tokens", "User has 3 withdrawals in last 24h"],
      "required_approvals": 1,
      "expires_at": "2025-10-01T10:00:00Z",
      "risk_signature": null
    }
  }

  Response (拒绝):
  {
    "success": true,
    "assessment": {
      "operation_id": "uuid",
      "risk_score": 95,
      "risk_level": "high",
      "decision": "deny",
      "reasons": ["Destination address is blacklisted", "User is in blacklist"],
      "required_approvals": 0,
      "risk_signature": null
    }
  }

  2. 人工审批 API

  POST /api/risk/approve
  Authorization: Bearer <admin_token>  // 需要管理员权限

  Request:
  {
    "operation_id": "uuid",
    "approver_user_id": 999,
    "approved": true,
    "comment": "Verified with user via phone call"
  }

  Response:
  {
    "success": true,
    "message": "Operation approved",
    "assessment": {
      "operation_id": "uuid",
      "approval_status": "approved",
      "current_approvals": 1,
      "required_approvals": 1,
      "risk_signature": "审批通过后的风控签名"
    }
  }

  3. 查询待审批操作

  GET /api/risk/pending?limit=20&offset=0
  Authorization: Bearer <admin_token>

  Response:
  {
    "success": true,
    "data": [
      {
        "id": 123,
        "operation_id": "uuid",
        "module": "wallet",
        "table": "withdraws",
        "action": "insert",
        "user_id": 456,
        "operation_summary": {
          "to_address": "0xabc...",
          "amount": "50000000000000000000000",
          "token_symbol": "ETH"
        },
        "risk_score": 65,
        "risk_level": "medium",
        "decision": "manual_review",
        "reasons": ["Large amount withdrawal: 50000 tokens"],
        "required_approvals": 1,
        "current_approvals": 0,
        "expires_at": "2025-10-01T10:00:00Z",
        "created_at": "2025-09-30T10:00:00Z"
      }
    ],
    "total": 5,
    "limit": 20,
    "offset": 0
  }

  4. 查询操作风控状态

  GET /api/risk/status/:operation_id

  Response:
  {
    "success": true,
    "assessment": {
      "operation_id": "uuid",
      "risk_score": 65,
      "risk_level": "medium",
      "decision": "manual_review",
      "approval_status": "pending",
      "current_approvals": 0,
      "required_approvals": 1,
      "expires_at": "2025-10-01T10:00:00Z",
      "approvals": []
    }
  }

  5. 规则管理 API

  // 获取所有规则
  GET /api/risk/rules

  // 创建规则
  POST /api/risk/rules
  {
    "id": "large_eth_withdraw",
    "name": "Large ETH Withdrawal",
    "description": "ETH withdrawals over 100 ETH",
    "table_name": "withdraws",
    "rule_type": "amount_threshold",
    "conditions": {
      "token_symbol": "ETH",
      "amount": { ">": "100000000000000000000" }
    },
    "risk_weight": 50,
    "enabled": true
  }

  // 更新规则
  PUT /api/risk/rules/:id

  // 禁用规则
  DELETE /api/risk/rules/:id

  ---
  🔐 环境变量配置

  risk_control/.env

  # 服务配置
  PORT=3004
  NODE_ENV=development

  # 数据库配置
  DATABASE_PATH=../db_gateway/wallet.db  # 共享业务数据库

  # 签名密钥
  RISK_CONTROL_PRIVATE_KEY=风控服务的私钥hex
  WALLET_PUBLIC_KEY=wallet服务的公钥hex
  SCAN_PUBLIC_KEY=scan服务的公钥hex

  # 风控配置
  DEFAULT_EXPIRE_HOURS=24
  MAX_RISK_SCORE=100

  wallet/.env

  # 添加风控服务地址
  RISK_CONTROL_URL=http://localhost:3004
  RISK_CONTROL_PUBLIC_KEY=风控服务的公钥hex

  scan/.env

  # 添加风控服务地址
  RISK_CONTROL_URL=http://localhost:3004
  RISK_CONTROL_PUBLIC_KEY=风控服务的公钥hex

  db_gateway/.env

  # 添加风控服务公钥
  RISK_CONTROL_PUBLIC_KEY=风控服务的公钥hex

  ---
  📝 实施步骤

  Phase 1: 数据库准备

  1. 在 wallet.db 中创建风控相关的6张表
  2. 初始化默认风控规则

  Phase 2: 创建 risk_control 服务

  1. 创建 risk_control 目录结构
  2. 实现风控评估引擎
  3. 实现规则评估器
  4. 实现 API 接口
  5. 添加签名生成功能

  Phase 3: 修改 wallet/scan 服务

  1. 添加 RiskControlClient 用于调用风控 API
  2. 在敏感操作前调用风控评估
  3. 获取风控签名后再调用 db_gateway

  Phase 4: 修改 db_gateway

  1. 在 signature.ts 中添加风控签名验证中间件
  2. 修改路由，敏感操作需要验证风控签名
  3. 移除现有的 RiskControlService 相关代码

  Phase 5: 测试

  1. 测试自动通过场景
  2. 测试需要审批场景
  3. 测试拒绝场景
  4. 测试人工审批流程

  ---
  🎁 总结

  这种设计的核心优势

  1. 安全隔离：风控服务独立运行，有自己的密钥对
  2. 双签名机制：敏感操作必须同时有业务签名和风控签名
  3. 职责清晰：
    - wallet/scan：业务逻辑
    - risk_control：风控决策
    - db_gateway：数据存储
  4. 数据共享：使用同一个数据库，风控可以查询完整的历史数据
  5. 流程透明：所有风控评估都有记录，便于审计
  6. 灵活扩展：可以随时添加新的风控规则

  关键点

  - ✅ 风控前置：在写入数据库前就进行风控评估
  - ✅ 双签名：business_signature + risk_control_signature
  - ✅ 共享数据库：风控服务可以直接查询业务数据
  - ✅ 审批机制：高风险操作需要人工审批
  - ✅ 完整审计：所有操作都有记录