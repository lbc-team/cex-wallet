# 钱包系统 API 使用说明


### 钱包表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| user_id | INTEGER | 用户ID，唯一 |
| address | TEXT | 钱包地址，唯一 |
| device | TEXT | 签名机设备地址（由 signer 模块自动设置） |
| path | TEXT | 推导路径 |
| chain_type | TEXT | 地址类型：evm、btc、solana |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

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

## 重要变更

1. **用户关联**：每个钱包现在必须关联到一个用户（user_id）
2. **唯一约束**：每个用户只能有一个钱包（user_id 唯一）
3. **路由更新**：API 路由已更新为 `user/{id}/address` 格式，使用 GET 请求
4. **数据库结构**：钱包表已添加 user_id 字段和外键约束
5. **智能获取**：`getUserWallet` 方法会先检查用户是否已有钱包，如果没有才创建新的
6. **设备配置**：`device` 信息现在通过环境变量 `SIGNER_DEVICE` 配置，不再作为请求参数

## 错误处理

### 常见错误响应

```json
{
  "error": "无效的用户ID"
}
```

```json
{
  "error": "不支持的链类型，支持的类型: evm, btc, solana"
}
```

```json
{
  "error": "Signer 模块不可用，请检查服务状态"
}
```

```json
{
  "error": "生成的钱包地址已被使用，请重试"
}
```

```json
{
  "error": "获取用户余额失败"
}
```

```json
{
  "error": "获取充值中余额失败"
}
```

```json
{
  "error": "代币符号不能为空"
}
```

```json
{
  "error": "用户没有 USDT 代币余额"
}
```

```json
{
  "error": "获取代币余额失败"
}
```


## 注意事项

1. 确保 Signer 模块已启动并设置了 MNEMONIC 环境变量
2. 每个用户只能有一个钱包
3. 钱包地址在系统中是唯一的
4. 系统会自动处理派生路径的递增
5. 如果用户已有钱包，API 会直接返回现有钱包信息，不会创建新的
6. device 字段由 signer 模块自动设置，用户无需指定
7. **用户余额总和**：跨所有链聚合相同代币的余额，`chain_count` 表示该代币分布在多少条链上
8. **充值中余额**：来自 `confirmed` 和 `safe` 状态的存款交易，需要达到 `finalized` 状态才会计入正式余额
9. **多链支持**：系统支持多链资产管理，余额按 `token_symbol` 聚合，但充值确认状态独立处理
10. **Decimals 处理**：所有余额相关API自动处理不同链上相同代币的 decimals 差异，返回标准化余额
11. **代币符号大小写**：API自动将代币符号转换为大写进行查询，支持小写输入
12. **余额精度格式化**：所有余额字段统一格式化为小数点后6位精度（例如："10.123456"），确保显示一致性
13. **原始余额保留**：在详情API中，`balance` 字段保留原始的大整数存储值，便于精确计算和审计
