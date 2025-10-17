-- DB Gateway Database Schema
-- 主数据库结构定义

-- ============================================
-- 1. 用户表 (users)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT,
  user_type TEXT DEFAULT 'normal',         -- normal(普通用户)、sys_hot_wallet(热钱包)、sys_multisig(多签)
  status INTEGER DEFAULT 0,                -- 0-正常，1-禁用，2-待审核
  kyc_status INTEGER DEFAULT 0,            -- 0-未认证，1-待审核，2-已认证，3-认证失败
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME
);

-- ============================================
-- 2. 钱包表 (wallets)
-- ============================================
CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,                         -- 用户ID，系统钱包可为空
  address TEXT UNIQUE NOT NULL,            -- 钱包地址，唯一
  device TEXT,                             -- 来自哪个签名机设备地址
  path TEXT,                               -- 推导路径
  chain_type TEXT NOT NULL,                -- 地址类型：evm、btc、solana
  wallet_type TEXT NOT NULL,               -- 钱包类型：user、hot、multisig、cold、vault
  is_active INTEGER DEFAULT 1,             -- 是否激活：0-未激活，1-激活
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============================================
-- 3. 钱包 Nonce 表 (wallet_nonces)
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_nonces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,                   -- 钱包地址
  chain_id INTEGER NOT NULL,               -- 链ID
  nonce INTEGER NOT NULL DEFAULT 0,        -- 当前 nonce 值
  last_used_at DATETIME,                   -- 最后使用时间
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(address, chain_id)                -- 每个钱包在每个链上只有一个nonce记录
);

-- ============================================
-- 4. 已使用操作ID表 (used_operation_ids)
-- 用于防止重放攻击
-- ============================================
CREATE TABLE IF NOT EXISTS used_operation_ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT UNIQUE NOT NULL,       -- 操作ID（UUID）
  used_at INTEGER NOT NULL,                -- 使用时间戳（毫秒）
  expires_at INTEGER NOT NULL,             -- 过期时间戳（毫秒）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 5. 区块表 (blocks) - EVM链
-- ============================================
CREATE TABLE IF NOT EXISTS blocks (
  hash TEXT PRIMARY KEY,                   -- 区块哈希
  parent_hash TEXT,                        -- 父区块哈希
  number TEXT NOT NULL,                    -- 区块号，大整数存储
  timestamp INTEGER,                       -- 区块时间戳
  status TEXT DEFAULT 'confirmed',         -- confirmed、safe、finalized、orphaned
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 5.1 Solana区块槽位表 (solana_slots)
-- ============================================
CREATE TABLE IF NOT EXISTS solana_slots (
  slot INTEGER PRIMARY KEY,                -- Solana槽位号
  block_hash TEXT,                         -- 区块哈希
  parent_slot INTEGER,                     -- 父槽位号
  block_time INTEGER,                      -- 区块时间戳
  status TEXT DEFAULT 'confirmed',         -- confirmed、finalized、skipped
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 6. 交易表 (transactions) - EVM链
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_hash TEXT,                         -- 区块哈希
  block_no INTEGER,                        -- 区块号
  tx_hash TEXT UNIQUE NOT NULL,            -- 交易哈希
  from_addr TEXT,                          -- 发起地址
  to_addr TEXT,                            -- 接收地址
  token_addr TEXT,                         -- Token 合约地址
  amount TEXT,                             -- 交易金额
  type TEXT,                               -- deposit/withdraw/collect/rebalance
  status TEXT DEFAULT 'confirmed',         -- confirmed/safe/finalized/failed
  confirmation_count INTEGER DEFAULT 0,    -- 确认数
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 6.1 Solana交易表 (solana_transactions)
-- ============================================
CREATE TABLE IF NOT EXISTS solana_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot INTEGER,                            -- 槽位号
  tx_hash TEXT UNIQUE NOT NULL,            -- 交易签名
  from_addr TEXT,                          -- 发起地址
  to_addr TEXT,                            -- 接收地址
  token_mint TEXT,                         -- SPL Token Mint地址 (NULL表示SOL)
  amount TEXT,                             -- 交易金额
  type TEXT,                               -- deposit/withdraw/collect/rebalance
  status TEXT DEFAULT 'confirmed',         -- confirmed/finalized/failed
  block_time INTEGER,                      -- 区块时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 7. 代币表 (tokens)
-- ============================================
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_type TEXT NOT NULL,                -- eth/btc/sol/polygon/bsc 等
  chain_id INTEGER NOT NULL,               -- 1(以太坊主网)/5(Goerli)/137(Polygon)/56(BSC)
  token_address TEXT,                      -- 代币合约地址（原生代币为空）
  token_symbol TEXT NOT NULL,              -- USDC/ETH/BTC/SOL
  token_name TEXT,                         -- USD Coin/Ethereum/Bitcoin
  decimals INTEGER DEFAULT 18,             -- 代币精度
  is_native BOOLEAN DEFAULT 0,             -- 是否为链原生代币
  collect_amount TEXT DEFAULT '0',         -- 归集金额阈值
  withdraw_fee TEXT DEFAULT '0',           -- 提现手续费
  min_withdraw_amount TEXT DEFAULT '0',    -- 最小提现金额
  status INTEGER DEFAULT 1,                -- 0-禁用，1-启用
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 8. 资金流水表 (credits)
-- ============================================
CREATE TABLE IF NOT EXISTS credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,                -- 用户ID
  address TEXT NOT NULL,                   -- 钱包地址
  token_id INTEGER NOT NULL,               -- 代币ID
  token_symbol TEXT NOT NULL,              -- 代币符号（冗余字段）
  amount TEXT NOT NULL,                    -- 金额（正数入账、负数出账）
  credit_type TEXT NOT NULL,               -- deposit/withdraw/collect/rebalance/trade_buy/trade_sell/freeze/unfreeze
  business_type TEXT NOT NULL,             -- blockchain/spot_trade/internal_transfer/admin_adjust
  reference_id TEXT NOT NULL,              -- 关联业务ID
  reference_type TEXT NOT NULL,            -- blockchain_tx/withdraw
  chain_id INTEGER,                        -- 链ID
  chain_type TEXT,                         -- 链类型
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/confirmed/finalized/failed/frozen
  block_number INTEGER,                    -- 区块号（链上交易）
  tx_hash TEXT,                            -- 交易哈希（链上交易）
  event_index INTEGER DEFAULT 0,           -- 事件索引
  metadata TEXT,                           -- JSON格式的扩展信息
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (token_id) REFERENCES tokens(id)
);

-- ============================================
-- 9. 提现记录表 (withdraws)
-- ============================================
CREATE TABLE IF NOT EXISTS withdraws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,                -- 用户ID
  operation_id TEXT UNIQUE,                -- 操作ID（UUID），用于关联风控记录
  to_address TEXT NOT NULL,                -- 提现目标地址
  token_id INTEGER NOT NULL,               -- 代币ID
  amount TEXT NOT NULL,                    -- 提现金额
  fee TEXT NOT NULL DEFAULT '0',           -- 提现手续费
  chain_id INTEGER NOT NULL,               -- 链ID
  chain_type TEXT NOT NULL,                -- evm/btc/solana
  from_address TEXT,                       -- 热钱包地址（签名时填充）
  tx_hash TEXT,                            -- 交易哈希（签名后填充）
  gas_price TEXT,                          -- Gas 价格（Legacy）
  max_fee_per_gas TEXT,                    -- 最大费用（EIP-1559）
  max_priority_fee_per_gas TEXT,           -- 优先费用（EIP-1559）
  gas_used TEXT,                           -- 实际使用的 gas
  nonce INTEGER,                           -- 交易 nonce
  status TEXT NOT NULL DEFAULT 'user_withdraw_request',  -- user_withdraw_request/risk_reviewing/manual_reviewing/signing/pending/processing/confirmed/failed/rejected
  error_message TEXT,                      -- 错误信息
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (token_id) REFERENCES tokens(id)
);

-- ============================================
-- 索引定义
-- ============================================

-- Blocks 表索引
CREATE INDEX IF NOT EXISTS idx_blocks_number ON blocks(number);
CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash);
CREATE INDEX IF NOT EXISTS idx_blocks_status ON blocks(status);

-- Solana Slots 表索引
CREATE INDEX IF NOT EXISTS idx_solana_slots_slot ON solana_slots(slot);
CREATE INDEX IF NOT EXISTS idx_solana_slots_status ON solana_slots(status);
CREATE INDEX IF NOT EXISTS idx_solana_slots_parent ON solana_slots(parent_slot);

-- Transactions 表索引
CREATE INDEX IF NOT EXISTS idx_transactions_block_hash ON transactions(block_hash);
CREATE INDEX IF NOT EXISTS idx_transactions_to_addr ON transactions(to_addr);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

-- Solana Transactions 表索引
CREATE INDEX IF NOT EXISTS idx_solana_transactions_slot ON solana_transactions(slot);
CREATE INDEX IF NOT EXISTS idx_solana_transactions_tx_hash ON solana_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_solana_transactions_to_addr ON solana_transactions(to_addr);
CREATE INDEX IF NOT EXISTS idx_solana_transactions_status ON solana_transactions(status);

-- Credits 表索引
CREATE INDEX IF NOT EXISTS idx_credits_user_token ON credits(user_id, token_id);
CREATE INDEX IF NOT EXISTS idx_credits_user_status ON credits(user_id, status);
CREATE INDEX IF NOT EXISTS idx_credits_reference ON credits(reference_id, reference_type);
CREATE INDEX IF NOT EXISTS idx_credits_tx_hash ON credits(tx_hash);
CREATE INDEX IF NOT EXISTS idx_credits_block_number ON credits(block_number);
CREATE INDEX IF NOT EXISTS idx_credits_status ON credits(status);
CREATE INDEX IF NOT EXISTS idx_credits_type ON credits(credit_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credits_unique ON credits(user_id, reference_id, reference_type, event_index);

-- Wallets 表索引
CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(address);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_chain_type ON wallets(chain_type);
CREATE INDEX IF NOT EXISTS idx_wallets_type ON wallets(wallet_type);
CREATE INDEX IF NOT EXISTS idx_wallets_active ON wallets(is_active);
CREATE INDEX IF NOT EXISTS idx_wallets_user_type ON wallets(user_id, wallet_type);

-- Tokens 表索引
CREATE INDEX IF NOT EXISTS idx_tokens_chain_symbol ON tokens(chain_type, chain_id, token_symbol);
CREATE INDEX IF NOT EXISTS idx_tokens_chain_address ON tokens(chain_type, chain_id, token_address);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_unique ON tokens(chain_type, chain_id, token_address, token_symbol);

-- Wallet Nonces 表索引
CREATE INDEX IF NOT EXISTS idx_wallet_nonces_address ON wallet_nonces(address);
CREATE INDEX IF NOT EXISTS idx_wallet_nonces_chain ON wallet_nonces(chain_id);
CREATE INDEX IF NOT EXISTS idx_wallet_nonces_last_used ON wallet_nonces(last_used_at);

-- Withdraws 表索引
CREATE INDEX IF NOT EXISTS idx_withdraws_user_id ON withdraws(user_id);
CREATE INDEX IF NOT EXISTS idx_withdraws_status ON withdraws(status);
CREATE INDEX IF NOT EXISTS idx_withdraws_chain ON withdraws(chain_id, chain_type);
CREATE INDEX IF NOT EXISTS idx_withdraws_tx_hash ON withdraws(tx_hash);
CREATE INDEX IF NOT EXISTS idx_withdraws_created_at ON withdraws(created_at);
CREATE INDEX IF NOT EXISTS idx_withdraws_operation_id ON withdraws(operation_id);

-- Used Operation IDs 表索引
CREATE INDEX IF NOT EXISTS idx_operation_ids_id ON used_operation_ids(operation_id);
CREATE INDEX IF NOT EXISTS idx_operation_ids_expires_at ON used_operation_ids(expires_at);

-- ============================================
-- 视图定义
-- ============================================

-- 1. 用户余额实时视图（按地址分组）
CREATE VIEW IF NOT EXISTS v_user_balances AS
SELECT
  c.user_id,
  c.address,
  c.token_id,
  c.token_symbol,
  t.decimals,
  SUM(CASE
    WHEN c.credit_type NOT IN ('freeze') AND (
      (c.credit_type = 'deposit' AND c.status = 'finalized') OR
      (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
    )
    THEN CAST(c.amount AS REAL)
    ELSE 0
  END) as available_balance,
  SUM(CASE
    WHEN c.credit_type = 'deposit' AND c.status = 'frozen'
    THEN ABS(CAST(c.amount AS REAL))
    ELSE 0
  END) as frozen_balance,
  SUM(CASE
    WHEN (
      (c.credit_type = 'deposit' AND c.status = 'finalized') OR
      (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
    )
    THEN CAST(c.amount AS REAL)
    ELSE 0
  END) as total_balance,
  PRINTF('%.6f', SUM(CASE
    WHEN c.credit_type NOT IN ('freeze') AND (
      (c.credit_type = 'deposit' AND c.status = 'finalized') OR
      (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
    )
    THEN CAST(c.amount AS REAL)
    ELSE 0
  END) / POWER(10, t.decimals)) as available_balance_formatted,
  PRINTF('%.6f', SUM(CASE
    WHEN c.credit_type = 'deposit' AND c.status = 'frozen'
    THEN ABS(CAST(c.amount AS REAL))
    ELSE 0
  END) / POWER(10, t.decimals)) as frozen_balance_formatted,
  PRINTF('%.6f', SUM(CASE
    WHEN (
      (c.credit_type = 'deposit' AND c.status = 'finalized') OR
      (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
    )
    THEN CAST(c.amount AS REAL)
    ELSE 0
  END) / POWER(10, t.decimals)) as total_balance_formatted,
  MAX(c.updated_at) as last_updated
FROM credits c
JOIN tokens t ON c.token_id = t.id
GROUP BY c.user_id, c.address, c.token_id, c.token_symbol, t.decimals
HAVING total_balance > 0;

-- 2. 用户代币总余额视图（跨地址聚合）
CREATE VIEW IF NOT EXISTS v_user_token_totals AS
SELECT
  c.user_id,
  c.token_id,
  c.token_symbol,
  t.decimals,
  SUM(CASE
    WHEN c.credit_type NOT IN ('freeze') AND (
      (c.credit_type = 'deposit' AND c.status = 'finalized') OR
      (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
    )
    THEN CAST(c.amount AS REAL)
    ELSE 0
  END) as total_available_balance,
  SUM(CASE
    WHEN c.credit_type = 'deposit' AND c.status = 'frozen'
    THEN ABS(CAST(c.amount AS REAL))
    ELSE 0
  END) as total_frozen_balance,
  SUM(CASE
    WHEN (
      (c.credit_type = 'deposit' AND c.status = 'finalized') OR
      (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
    )
    THEN CAST(c.amount AS REAL)
    ELSE 0
  END) as total_balance,
  PRINTF('%.6f', SUM(CASE
    WHEN c.credit_type NOT IN ('freeze') AND (
      (c.credit_type = 'deposit' AND c.status = 'finalized') OR
      (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
    )
    THEN CAST(c.amount AS REAL)
    ELSE 0
  END) / POWER(10, t.decimals)) as total_available_formatted,
  PRINTF('%.6f', SUM(CASE
    WHEN c.credit_type = 'deposit' AND c.status = 'frozen'
    THEN ABS(CAST(c.amount AS REAL))
    ELSE 0
  END) / POWER(10, t.decimals)) as total_frozen_formatted,
  PRINTF('%.6f', SUM(CASE
    WHEN (
      (c.credit_type = 'deposit' AND c.status = 'finalized') OR
      (c.credit_type = 'withdraw' AND c.status IN ('confirmed', 'finalized'))
    )
    THEN CAST(c.amount AS REAL)
    ELSE 0
  END) / POWER(10, t.decimals)) as total_balance_formatted,
  COUNT(DISTINCT c.address) as address_count,
  MAX(c.updated_at) as last_updated
FROM credits c
JOIN tokens t ON c.token_id = t.id
GROUP BY c.user_id, c.token_id, c.token_symbol, t.decimals
HAVING total_balance > 0;

-- 3. 用户余额统计视图
CREATE VIEW IF NOT EXISTS v_user_balance_stats AS
SELECT
  user_id,
  COUNT(DISTINCT token_id) as token_count,
  COUNT(DISTINCT address) as address_count,
  SUM(CASE WHEN total_balance > 0 THEN 1 ELSE 0 END) as positive_balance_count,
  MAX(last_updated) as last_balance_update
FROM v_user_token_totals
GROUP BY user_id;
