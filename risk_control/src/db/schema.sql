-- Risk Control Database Schema
-- 风控独立数据库

-- 1. 风控评估记录表 (risk_assessments)
CREATE TABLE IF NOT EXISTS risk_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT UNIQUE NOT NULL,     -- 操作ID (UUID，由业务层生成)
  table_name TEXT,                       -- 业务表名 (withdrawals/credits等)，可为空用于非数据库操作
  record_id INTEGER,                     -- 业务表记录ID (双向关联)
  action TEXT NOT NULL,                  -- 操作类型 (insert/update/delete/withdraw等)
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

-- 索引
CREATE INDEX IF NOT EXISTS idx_risk_assessments_operation ON risk_assessments(operation_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_user ON risk_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_decision ON risk_assessments(decision);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_approval_status ON risk_assessments(approval_status);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_record ON risk_assessments(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_expires ON risk_assessments(expires_at);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_created ON risk_assessments(created_at);


-- 2. 人工审批记录表 (risk_manual_reviews)
CREATE TABLE IF NOT EXISTS risk_manual_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL,        -- 关联 risk_assessments.id
  operation_id TEXT NOT NULL,            -- 关联 operation_id (冗余字段，方便查询)

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

-- 索引
CREATE INDEX IF NOT EXISTS idx_risk_manual_reviews_assessment ON risk_manual_reviews(assessment_id);
CREATE INDEX IF NOT EXISTS idx_risk_manual_reviews_operation ON risk_manual_reviews(operation_id);
CREATE INDEX IF NOT EXISTS idx_risk_manual_reviews_approver ON risk_manual_reviews(approver_user_id);
CREATE INDEX IF NOT EXISTS idx_risk_manual_reviews_created ON risk_manual_reviews(created_at);


-- 3. 地址风险表 (address_risk_list)
CREATE TABLE IF NOT EXISTS address_risk_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,                 -- 地址 (保持原始大小写)
  chain_type TEXT NOT NULL,              -- evm/btc/solana

  risk_type TEXT NOT NULL,               -- blacklist/whitelist/suspicious/sanctioned
  risk_level TEXT DEFAULT 'medium',      -- low/medium/high
  reason TEXT,                           -- 风险原因
  source TEXT DEFAULT 'manual',          -- manual/auto/chainalysis/ofac

  enabled INTEGER DEFAULT 1,             -- 是否启用

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(address, chain_type)            -- 同一链上地址唯一
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_address_risk_address ON address_risk_list(address);
CREATE INDEX IF NOT EXISTS idx_address_risk_chain_type ON address_risk_list(chain_type);
CREATE INDEX IF NOT EXISTS idx_address_risk_type ON address_risk_list(risk_type);
CREATE INDEX IF NOT EXISTS idx_address_risk_enabled ON address_risk_list(enabled);
