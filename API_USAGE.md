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

### 2. 获取钱包余额

**请求**：
```http
GET /api/wallet/{wallet_id}/balance
```

**响应**：
```json
{
  "data": {
    "balance": 100.5
  }
}
```

## 使用示例

### 获取用户钱包

```bash
# 获取用户ID为123的钱包地址（如果不存在则创建）
curl "http://localhost:3000/api/user/123/address?chain_type=evm"
```

### 获取钱包余额

```bash
# 获取钱包ID为1的余额
curl http://localhost:3000/api/wallet/1/balance
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


## 注意事项

1. 确保 Signer 模块已启动并设置了 MNEMONIC 环境变量
2. 每个用户只能有一个钱包
3. 钱包地址在系统中是唯一的
4. 系统会自动处理派生路径的递增
5. 如果用户已有钱包，API 会直接返回现有钱包信息，不会创建新的
6. device 字段由 signer 模块自动设置，用户无需指定
