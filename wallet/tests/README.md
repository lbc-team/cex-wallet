# 钱包API测试套件

这个测试套件用于测试CEX钱包系统的API功能，包括钱包的创建、查询、更新等操作。

## 文件结构

```
tests/
├── README.md           # 测试说明文档
├── test-utils.ts       # 测试工具函数
├── wallet.test.ts      # 钱包API测试
└── run-tests.ts        # 测试运行器
```

## 测试功能

### 钱包测试 (wallet.test.ts)

1. **服务器健康检查** - 验证服务器是否正常运行
2. **创建钱包** - 测试创建新钱包功能
3. **获取钱包列表** - 测试获取所有钱包
4. **根据ID获取钱包** - 测试根据ID查询钱包详情
5. **获取钱包余额** - 测试获取钱包余额
6. **更新钱包余额** - 测试更新钱包余额
7. **获取钱包统计** - 测试获取钱包统计信息
8. **创建重复钱包** - 测试重复钱包创建的错误处理
9. **无效数据验证** - 测试无效数据的错误处理

## 运行测试

### 前提条件

1. 确保钱包服务器正在运行：
   ```bash
   npm run dev
   ```

2. 服务器应该运行在 `http://localhost:3000`

### 运行所有测试

```bash
npm test
```

### 只运行钱包测试

```bash
npm run test:wallet
```

### 直接运行测试文件

```bash
npx ts-node tests/run-tests.ts
npx ts-node tests/wallet.test.ts
```

## 测试输出

测试运行时会显示：

- ✅ 通过的测试（绿色）
- ❌ 失败的测试（红色）
- 测试执行时间
- 详细的测试结果汇总

### 示例输出

```
🧪 CEX钱包系统 - API测试套件
================================

🚀 开始钱包API测试...
✅ 服务器健康检查通过
✅ 钱包创建成功 - 地址: 0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6
✅ 获取钱包列表成功 - 共 1 个钱包
✅ 根据ID获取钱包成功 - ID: 1
✅ 获取钱包余额成功 - 余额: 0
✅ 更新钱包余额成功 - 新余额: 100.5
✅ 获取钱包统计成功
✅ 重复钱包创建被正确拒绝
✅ 无效钱包数据被正确拒绝

=== 测试结果汇总 ===
总测试数: 9
通过: 9
失败: 0
成功率: 100.00%

=== 详细结果 ===
✅ 服务器健康检查: 服务器正常运行 - CEX钱包系统 - 主模块 (45ms)
✅ 创建钱包: 钱包创建成功 - ID: 1 (23ms)
✅ 获取钱包列表: 获取到 1 个钱包 (12ms)
✅ 根据ID获取钱包: 成功获取钱包 - ID: 1 (8ms)
✅ 获取钱包余额: 钱包余额: 0 (7ms)
✅ 更新钱包余额: 余额更新为: 100.5 (15ms)
✅ 获取钱包统计: 统计信息获取成功 (9ms)
✅ 创建重复钱包: 正确拒绝重复钱包创建 (6ms)
✅ 无效钱包数据验证: 正确拒绝无效钱包数据 (5ms)

🎉 所有测试完成！
```

## 测试工具

### HttpClient

用于发送HTTP请求的工具类：

```typescript
const client = new HttpClient('http://localhost:3000');
const response = await client.get('/api/wallets');
const response = await client.post('/api/wallets', walletData);
```

### TestResult

用于记录和汇总测试结果：

```typescript
const result = new TestResult();
result.addResult('测试名称', 'PASS', '测试通过', 100);
result.printSummary();
```

### 工具函数

- `generateTestWallet()` - 生成测试钱包数据
- `generateWalletAddress()` - 生成随机钱包地址
- `colorLog()` - 彩色日志输出
- `delay()` - 延迟函数

## 扩展测试

要添加新的测试：

1. 在 `wallet.test.ts` 中添加新的测试方法
2. 在 `runAllTests()` 中调用新测试
3. 使用 `TestResult` 记录测试结果

## 注意事项

1. 测试会创建真实的数据，建议在测试环境中运行
2. 测试之间可能存在依赖关系，按顺序执行
3. 确保服务器在测试前已经启动
4. 测试完成后会保留创建的数据
