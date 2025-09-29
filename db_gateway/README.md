# Database Gateway Service

Database Gateway Service是一个安全的数据库访问网关，使用Ed25519签名验证确保所有数据库操作的安全性，并集成风控系统防止内部作恶。

## 功能特性

- **Ed25519签名验证**: 所有写操作必须经过签名验证
- **权限分级**: 读操作、写操作、敏感操作的分级管理
- **风控系统**: 敏感操作自动风控评估，支持人工审批
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

### 审计日志

#### GET /api/audit/logs

查询审计日志。

**查询参数**：
- `operation_id`: 操作ID
- `module`: 模块名称
- `table_name`: 表名
- `result`: success|failed
- `from_timestamp`: 开始时间戳
- `to_timestamp`: 结束时间戳
- `limit`: 限制数量

### 风控系统

#### POST /api/risk-control/evaluate

评估操作风险。

#### POST /api/risk-control/approve

人工风控审批。

#### GET /api/risk-control/pending

获取待审批操作。

#### GET /api/risk-control/rules

获取风控规则。

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

## 安全措施

1. **时间戳验证**: 防重放攻击，5分钟时间窗口
2. **签名验证**: Ed25519数字签名确保请求来源
3. **操作审计**: 所有操作完整记录
4. **权限隔离**: 模块无法绕过网关直接访问数据库
5. **风控评估**: 敏感操作自动风险评估

## 监控和告警

### 日志级别

- `ERROR`: 系统错误
- `WARN`: 安全告警（签名失败、风控触发）
- `INFO`: 操作记录
- `DEBUG`: 详细调试信息

### 关键监控指标

- 签名验证成功率
- 风控规则触发频率
- 操作响应时间
- 审计日志完整性

## 部署建议

### 生产环境

1. **独立部署**: Database Gateway独立部署
2. **网络隔离**: 只允许内网访问
3. **密钥管理**: 使用HSM或安全密钥管理服务
4. **监控告警**: 集成监控系统
5. **备份策略**: 审计日志定期备份

### 高可用

1. **负载均衡**: 多实例部署 + 负载均衡
2. **数据库**: 主从复制或集群
3. **故障转移**: 自动故障检测和恢复

## 故障排除

### 常见错误

1. **SIGNATURE_VERIFICATION_FAILED**: 检查私钥配置和签名算法
2. **TIMESTAMP_EXPIRED**: 检查系统时间同步
3. **NO_PUBLIC_KEY**: 检查网关公钥配置
4. **RISK_CONTROL_DENIED**: 检查风控规则设置

### 调试工具

```bash
# 检查服务状态
curl http://localhost:3003/health

# 生成测试密钥对
curl -X POST http://localhost:3003/generate-keypair

# 查看审计日志
curl "http://localhost:3003/api/audit/logs?limit=10"
```