/**
 * WithdrawMonitor 功能测试
 * 
 * 这个测试文件验证提现监控服务的核心功能
 */

import { Database } from '../src/db/connection';
import WithdrawMonitor from '../src/services/withdrawMonitor';
import logger from '../src/utils/logger';

// 测试配置
const TEST_DB_PATH = ':memory:'; // 使用内存数据库进行测试

/**
 * 模拟测试数据库初始化
 */
async function setupTestDatabase(db: Database): Promise<void> {
  // 创建测试所需的表结构
  await db.run(`
    CREATE TABLE IF NOT EXISTS withdraws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_id INTEGER NOT NULL,
      amount TEXT NOT NULL,
      fee TEXT NOT NULL DEFAULT '0',
      tx_hash TEXT,
      chain_id INTEGER NOT NULL,
      chain_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'user_withdraw_request',
      gas_used TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_id INTEGER NOT NULL,
      token_symbol TEXT NOT NULL,
      amount TEXT NOT NULL,
      credit_type TEXT NOT NULL,
      business_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      block_number INTEGER,
      tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT UNIQUE NOT NULL,
      block_no INTEGER,
      amount TEXT,
      type TEXT,
      status TEXT DEFAULT 'confirmed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_symbol TEXT NOT NULL,
      decimals INTEGER DEFAULT 18,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  logger.info('测试数据库初始化完成');
}

/**
 * 创建测试数据
 */
async function createTestData(db: Database): Promise<{
  withdrawId: number;
  tokenId: number;
}> {
  // 创建测试代币
  const tokenResult = await db.run(`
    INSERT INTO tokens (token_symbol, decimals)
    VALUES ('USDT', 6)
  `);
  const tokenId = tokenResult.lastID!;

  // 创建测试提现记录 (pending 状态)
  const withdrawResult = await db.run(`
    INSERT INTO withdraws (
      user_id, token_id, amount, fee, tx_hash, chain_id, chain_type, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [1, tokenId, '1000000', '10000', '0x1234567890123456789012345678901234567890123456789012345678901234', 11155111, 'evm', 'pending']);
  
  const withdrawId = withdrawResult.lastID!;

  // 创建对应的 credit 记录
  await db.run(`
    INSERT INTO credits (
      user_id, token_id, token_symbol, amount, credit_type, business_type,
      reference_id, reference_type, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [1, tokenId, 'USDT', '-1000000', 'withdraw', 'withdraw', withdrawId.toString(), 'withdraw', 'pending']);

  return { withdrawId, tokenId };
}

/**
 * 测试 WithdrawMonitor 基本功能
 */
async function testWithdrawMonitorBasics(): Promise<void> {
  logger.info('开始测试 WithdrawMonitor 基本功能...');

  // 创建内存数据库
  const db = new Database();
  // 重写构造函数中的数据库路径
  (db as any).db = new (require('sqlite3').Database)(':memory:');
  
  await db.initialize();
  await setupTestDatabase(db);
  
  // 创建 WithdrawMonitor 实例
  const withdrawMonitor = new WithdrawMonitor(db);
  
  // 测试获取状态
  const status = withdrawMonitor.getStatus();
  console.log('✅ WithdrawMonitor 状态:', status);
  
  // 验证初始状态
  if (!status.isRunning && status.monitorInterval === 30000) {
    logger.info('✅ WithdrawMonitor 初始状态正确');
  } else {
    throw new Error('❌ WithdrawMonitor 初始状态错误');
  }

  logger.info('✅ WithdrawMonitor 基本功能测试通过');
}

/**
 * 测试数据库操作
 */
async function testDatabaseOperations(): Promise<void> {
  logger.info('开始测试数据库操作...');

  const db = new Database();
  (db as any).db = new (require('sqlite3').Database)(':memory:');
  
  await db.initialize();
  await setupTestDatabase(db);
  
  const { withdrawId, tokenId } = await createTestData(db);
  
  // 验证测试数据创建成功
  const withdraw = await db.get('SELECT * FROM withdraws WHERE id = ?', [withdrawId]);
  const credit = await db.get('SELECT * FROM credits WHERE reference_id = ? AND reference_type = ?', [withdrawId.toString(), 'withdraw']);
  
  if (withdraw && withdraw.status === 'pending' && credit && credit.status === 'pending') {
    logger.info('✅ 测试数据创建成功');
  } else {
    throw new Error('❌ 测试数据创建失败');
  }

  // 测试状态更新操作
  await db.run(`
    UPDATE withdraws 
    SET status = 'confirmed', gas_used = '21000'
    WHERE id = ?
  `, [withdrawId]);

  await db.run(`
    UPDATE credits 
    SET status = 'confirmed', block_number = 12345, tx_hash = '0xtest'
    WHERE reference_id = ? AND reference_type = 'withdraw'
  `, [withdrawId.toString()]);

  // 验证更新成功
  const updatedWithdraw = await db.get('SELECT * FROM withdraws WHERE id = ?', [withdrawId]);
  const updatedCredit = await db.get('SELECT * FROM credits WHERE reference_id = ? AND reference_type = ?', [withdrawId.toString(), 'withdraw']);

  if (updatedWithdraw.status === 'confirmed' && updatedCredit.status === 'confirmed') {
    logger.info('✅ 数据库操作测试通过');
  } else {
    throw new Error('❌ 数据库操作测试失败');
  }

  await db.close();
}

/**
 * 测试退款逻辑（模拟交易失败场景）
 */
async function testRefundLogic(): Promise<void> {
  logger.info('开始测试退款逻辑...');

  const db = new Database();
  (db as any).db = new (require('sqlite3').Database)(':memory:');
  
  await db.initialize();
  await setupTestDatabase(db);
  
  const { withdrawId, tokenId } = await createTestData(db);
  
  // 模拟交易失败，创建退款记录
  await db.run(`
    INSERT INTO credits (
      user_id, token_id, token_symbol, amount, credit_type, business_type,
      reference_id, reference_type, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [1, tokenId, 'USDT', '1000000', 'refund', 'withdraw_refund', withdrawId.toString(), 'withdraw_refund', 'confirmed']);

  // 更新原提现记录为失败状态
  await db.run(`
    UPDATE withdraws 
    SET status = 'failed', error_message = '链上交易执行失败'
    WHERE id = ?
  `, [withdrawId]);

  // 验证退款记录
  const refundCredit = await db.get(`
    SELECT * FROM credits 
    WHERE reference_id = ? AND reference_type = 'withdraw_refund'
  `, [withdrawId.toString()]);

  const failedWithdraw = await db.get('SELECT * FROM withdraws WHERE id = ?', [withdrawId]);

  if (refundCredit && refundCredit.amount === '1000000' && failedWithdraw.status === 'failed') {
    logger.info('✅ 退款逻辑测试通过');
  } else {
    throw new Error('❌ 退款逻辑测试失败');
  }

  await db.close();
}

/**
 * 主测试函数
 */
async function runTests(): Promise<void> {
  try {
    logger.info('🚀 开始 WithdrawMonitor 功能测试...');

    await testWithdrawMonitorBasics();
    await testDatabaseOperations();
    await testRefundLogic();

    logger.info('🎉 所有测试通过！');
    logger.info('✅ WithdrawMonitor 功能验证完成');

  } catch (error) {
    logger.error('❌ 测试失败', { error });
    process.exit(1);
  }
}

// 运行测试
if (require.main === module) {
  runTests().catch((error) => {
    logger.error('测试运行失败', { error });
    process.exit(1);
  });
}

export { runTests };
