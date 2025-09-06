import { runSignerTests } from './signer.test';

// 运行 Signer 模块测试
async function main() {
  console.log('🧪 开始运行 Signer 模块测试...\n');
  
  try {
    await runSignerTests();
    console.log('\n🎉 Signer 模块测试完成！');
  } catch (error) {
    console.error('\n❌ 测试执行失败:', error);
    process.exit(1);
  }
}

// 运行测试
main();
