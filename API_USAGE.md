# 钱包系统 API 使用说明

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

**说明**：获取用户在所有链上的代币余额总和，不区分 chain_id

**响应**：
```json
{
  "message": "获取用户余额总和成功",
  "data": [
    {
      "token_symbol": "USDT",
      "total_balance": "3.500000",
      "chain_count": 3
    },
    {
      "token_symbol": "ETH",
      "total_balance": "2.000000",
      "chain_count": 1
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
 
## 注意事项


4. 如果用户已有钱包，API 会直接返回现有钱包信息，不会创建新的
5. device 字段由 signer 模块自动设置，用户无需指定
6. **用户余额总和**：跨所有链聚合相同代币的余额，`chain_count` 表示该代币分布在多少条链上
7. **充值中余额**：来自 `confirmed` 和 `safe` 状态的存款交易，需要达到 `finalized` 状态才会计入正式余额
8. **多链支持**：系统支持多链资产管理，余额按 `token_symbol` 聚合，但充值确认状态独立处理
9.  **Decimals 处理**：所有余额相关API自动处理不同链上相同代币的 decimals 差异，返回标准化余额
10. **代币符号大小写**：API自动将代币符号转换为大写进行查询，支持小写输入
11. **余额精度格式化**：所有余额字段统一格式化为小数点后6位精度（例如："10.123456"），确保显示一致性
12. **原始余额保留**：在详情API中，`balance` 字段保留原始的大整数存储值，便于精确计算和审计
