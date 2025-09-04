#!/usr/bin/env ts-node

import { runWalletTests } from './wallet.test';
import { colorLog } from './test-utils';

async function main() {
  colorLog('🧪 CEX钱包系统 - API测试套件', 'bright');
  colorLog('================================', 'cyan');
  
  try {
    await runWalletTests();
    colorLog('\n🎉 所有测试完成！', 'green');
  } catch (error) {
    colorLog(`\n💥 测试执行出错: ${error}`, 'red');
    process.exit(1);
  }
}

// 运行测试
main();
