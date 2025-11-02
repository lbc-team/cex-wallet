# 钱包系统 API 使用说明

各服务默认端口：

- **Wallet**: `http://localhost:3000`
- **Signer**: `http://localhost:3001`
- **Scan**: 
  - evm scan: `http://localhost:3002`
- **DB Gateway**: `http://localhost:3003`
- **Risk Control**: `http://localhost:3004`



## API 接口

### 1. 获取用户钱包地址

**请求**：
```http
GET /api/user/{user_id}/address?chain_type=evm
```

**响应**：
```json
{
  "message": "获取用户钱包成功",
  "data": {
    "id": 1,
    "user_id": 123,
    "address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
    "path": "m/44'/60'/0'/0/0",
    "chain_type": "evm",
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### 2. 获取用户余额总和

**请求**：
```http
GET /api/user/{user_id}/balance/total
```

**说明**：获取用户在所有链上的代币余额总和，基于Credits流水表聚合计算，支持可用余额和冻结余额

**响应**：
```json
{
  "message": "获取用户余额总和成功",
  "data": [
    {
      "token_symbol": "USDT",
      "total_balance": "3.500000",
      "available_balance": "3.000000",
      "frozen_balance": "0.500000",
      "address_count": 2
    },
    {
      "token_symbol": "ETH",
      "total_balance": "2.000000",
      "available_balance": "2.000000",
      "frozen_balance": "0.000000",
      "address_count": 1
    }
  ]
}
```

### 3. 获取用户充值中的余额

**请求**：
```http
GET /api/user/{user_id}/balance/pending
```

**说明**：获取用户正在充值的余额，这些余额来自状态为 `confirmed` 和 `safe` 的存款交易

**响应**：
```json
{
  "message": "获取充值中余额成功",
  "data": [
    {
      "token_symbol": "ETH",
      "pending_amount": "0.500000",
      "transaction_count": 2
    },
    {
      "token_symbol": "USDT",
      "pending_amount": "100.000000",
      "transaction_count": 1
    }
  ]
}
```

### 4. 获取用户指定代币的余额详情

**请求**：
```http
GET /api/user/{user_id}/balance/token/{token_symbol}
```

**说明**：获取用户指定代币在所有链上的余额详情，自动处理不同链上 decimals 不一致的情况，返回标准化后的余额

**响应**：
```json
{
  "message": "获取USDT余额详情成功",
  "data": {
    "token_symbol": "USDT",
    "total_normalized_balance": "3.500000",
    "chain_count": 3,
    "chain_details": [
      {
        "chain_type": "bsc",
        "token_id": 7,
        "balance": "2000000000000000000",
        "decimals": 18,
        "normalized_balance": "2.000000"
      },
      {
        "chain_type": "eth",
        "token_id": 8,
        "balance": "1000000",
        "decimals": 6,
        "normalized_balance": "1.000000"
      },
      {
        "chain_type": "polygon",
        "token_id": 10,
        "balance": "500000",
        "decimals": 6,
        "normalized_balance": "0.500000"
      }
    ]
  }
}
```

## 使用示例

### 获取用户钱包

```bash
# 获取用户ID为123的钱包地址（如果不存在则创建）
curl "http://localhost:3000/api/user/123/address?chain_type=evm"
```

### 获取用户余额总和

```bash
# 获取用户ID为123的所有链余额总和
curl http://localhost:3000/api/user/123/balance/total
```

### 获取用户充值中余额

```bash
# 获取用户ID为123的充值中余额
curl http://localhost:3000/api/user/123/balance/pending
```

### 获取用户指定代币余额详情

```bash
# 获取用户ID为123的USDT余额详情
curl http://localhost:3000/api/user/123/balance/token/USDT

# 获取用户ID为123的ETH余额详情
curl http://localhost:3000/api/user/123/balance/token/ETH
```
 
### 5. 用户提现

**请求**：
```http
POST /api/user/withdraw
Content-Type: application/json

{
  "userId": 123,
  "to": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
  "amount": "1.5",
  "tokenSymbol": "USDT",
  "chainId": 1,
  "chainType": "evm"
}
```

**说明**：用户发起提现请求，系统会自动选择合适的热钱包进行签名，并估算 Gas 费用

**响应**：
```json
{
  "message": "提现签名成功",
  "data": {
    "signedTransaction": "0x...",
    "transactionHash": "0x...",
    "withdrawAmount": "1.500000",
    "actualAmount": "1.450000",
    "fee": "0.050000",
    "withdrawId": 1,
    "gasEstimation": {
      "gasLimit": "21000",
      "maxFeePerGas": "20000000000",
      "maxPriorityFeePerGas": "2000000000",
      "networkCongestion": "medium"
    }
  }
}
```

### 6. 获取用户提现记录

**请求**：
```http
GET /api/user/{user_id}/withdraws?status=pending&limit=20&offset=0
```

**说明**：获取用户的提现记录，支持按状态筛选和分页

**查询参数**：
- `status` (可选): 提现状态筛选 (`user_withdraw_request`, `signing`, `pending`, `processing`, `confirmed`, `failed`)
- `limit` (可选): 每页记录数，默认20
- `offset` (可选): 偏移量，默认0

**响应**：
```json
{
  "message": "获取用户提现记录成功",
  "data": {
    "withdraws": [
      {
        "id": 1,
        "user_id": 123,
        "to_address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
        "token_id": 1,
        "amount": "1.500000",
        "fee": "0.050000",
        "chain_id": 1,
        "chain_type": "evm",
        "from_address": "0x...",
        "tx_hash": "0x...",
        "status": "confirmed",
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 1,
      "limit": 20,
      "offset": 0,
      "hasMore": false
    }
  }
}
```

### 7. 获取提现记录详情

**请求**：
```http
GET /api/withdraws/{withdraw_id}
```

**说明**：获取特定提现记录的详细信息，包括关联的 credit 记录

**响应**：
```json
{
  "message": "获取提现记录详情成功",
  "data": {
    "withdraw": {
      "id": 1,
      "user_id": 123,
      "to_address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
      "token_id": 1,
      "amount": "1.500000",
      "fee": "0.050000",
      "chain_id": 1,
      "chain_type": "evm",
      "from_address": "0x...",
      "tx_hash": "0x...",
      "gas_price": "20000000000",
      "max_fee_per_gas": "20000000000",
      "max_priority_fee_per_gas": "2000000000",
      "gas_used": "21000",
      "nonce": 1,
      "status": "confirmed",
      "error_message": null,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    },
    "credits": [
      {
        "id": 1,
        "user_id": 123,
        "token_id": 1,
        "amount": "-1.500000",
        "balance": "0.000000",
        "reference_type": "withdraw",
        "reference_id": 1,
        "created_at": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### 8. 获取待处理提现 

**请求**：
```http
GET /api/withdraws/pending
```

**说明**：获取所有待处理的提现记录，用于管理员监控和确认

**响应**：
```json
{
  "message": "获取待处理提现成功",
  "data": {
    "withdraws": [
      {
        "id": 1,
        "user_id": 123,
        "to_address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
        "token_id": 1,
        "amount": "1.500000",
        "fee": "0.050000",
        "chain_id": 1,
        "chain_type": "evm",
        "status": "pending",
        "created_at": "2024-01-01T00:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```

### 9. 更新提现状态 

**请求**：
```http
PUT /api/withdraws/{withdraw_id}/status
Content-Type: application/json

{
  "status": "confirmed",
  "txHash": "0x...",
  "gasUsed": "21000",
  "errorMessage": null
}
```

**说明**：管理员更新提现状态，支持的状态包括：`user_withdraw_request`, `signing`, `pending`, `processing`, `confirmed`, `failed`

**响应**：
```json
{
  "message": "更新提现状态成功",
  "data": {
    "withdrawId": 1,
    "status": "confirmed"
  }
}
```


## 使用示例

### 用户提现

```bash
# 用户发起提现请求
curl -X POST "http://localhost:3000/api/user/withdraw" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 123,
    "to": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
    "amount": "1.5",
    "tokenSymbol": "USDT",
    "chainId": 1,
    "chainType": "evm"
  }'
```

### 获取用户提现记录

```bash
# 获取用户ID为123的所有提现记录
curl "http://localhost:3000/api/user/123/withdraws"

# 获取用户ID为123的待处理提现记录
curl "http://localhost:3000/api/user/123/withdraws?status=pending"

# 分页获取提现记录
curl "http://localhost:3000/api/user/123/withdraws?limit=10&offset=0"
```

### 获取提现记录详情

```bash
# 获取提现ID为1的详细信息
curl "http://localhost:3000/api/withdraws/1"
```

### 管理员操作

```bash
# 获取所有待处理的提现
curl "http://localhost:3000/api/withdraws/pending"

# 更新提现状态为已确认
curl -X PUT "http://localhost:3000/api/withdraws/1/status" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "confirmed",
    "txHash": "0x...",
    "gasUsed": "21000"
  }'
```




## 注意事项

1. 如果用户已有钱包，API 会直接返回现有钱包信息，不会创建新的
2. device 字段由 signer 模块自动设置，用户无需指定
3. **用户余额总和**：跨所有链聚合相同代币的余额，`chain_count` 表示该代币分布在多少条链上
4. **充值中余额**：来自 `confirmed` 和 `safe` 状态的存款交易，需要达到 `finalized` 状态才会计入正式余额
5. **多链支持**：系统支持多链资产管理，余额按 `token_symbol` 聚合，但充值确认状态独立处理
6. **Decimals 处理**：所有余额相关API自动处理不同链上相同代币的 decimals 差异，返回标准化余额
7. **代币符号大小写**：API自动将代币符号转换为大写进行查询，支持小写输入
8. **余额精度格式化**：所有余额字段统一格式化为小数点后6位精度（例如："10.123456"），确保显示一致性
9. **原始余额保留**：在详情API中，`balance` 字段保留原始的大整数存储值，便于精确计算和审计
10. **提现流程**：用户发起提现 → 系统选择热钱包 → 签名交易 → 管理员确认 → 状态更新
11. **提现状态**：`user_withdraw_request` → `signing` → `pending` → `processing` → `confirmed`/`failed`
12. **Gas 费用估算**：系统自动估算 Gas 费用，支持 EIP-1559 交易类型
13. **地址验证**：提现目标地址必须符合以太坊地址格式（0x开头，40位十六进制）

