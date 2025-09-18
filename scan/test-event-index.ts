import { viemClient } from './src/utils/viemClient';
import { EventIndexHelper } from './src/utils/eventIndexHelper';

async function testEventIndex() {
  try {
    console.log('测试事件索引获取...');

    // 获取一个包含多个Transfer事件的交易
    const txHash = '0xce74448a2dcaf90a4a00febcb3cb831f43fdbca86a18fe6c30480603ba5cf3b8';
    
    console.log('获取交易收据...');
    const receipt = await viemClient.getTransactionReceipt(txHash);
    
    if (!receipt || !receipt.logs) {
      console.log('❌ 交易收据没有logs');
      return;
    }

    console.log(`✅ 找到 ${receipt.logs.length} 个事件日志`);

    // 显示所有事件的索引信息
    receipt.logs.forEach((log, index) => {
      console.log(`事件 ${index}:`);
      console.log(`  - logIndex: ${log.logIndex}`);
      console.log(`  - transactionIndex: ${log.transactionIndex}`);
      console.log(`  - address: ${log.address}`);
      console.log(`  - topics[0]: ${log.topics[0]}`);
      
      // 检查是否是Transfer事件
      const isTransfer = log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      console.log(`  - isTransfer: ${isTransfer}`);
      
      if (isTransfer) {
        const transferEvent = viemClient.parseERC20Transfer(log);
        if (transferEvent) {
          console.log(`  - from: ${transferEvent.from}`);
          console.log(`  - to: ${transferEvent.to}`);
          console.log(`  - value: ${transferEvent.value.toString()}`);
          
          // 测试事件索引生成
          const eventIndex = EventIndexHelper.getEventIndex(txHash, Number(log.logIndex));
          const referenceId = EventIndexHelper.generateCreditReferenceId(txHash, eventIndex);
          
          console.log(`  - eventIndex: ${eventIndex}`);
          console.log(`  - referenceId: ${referenceId}`);
        }
      }
      console.log('---');
    });

    // 测试解析引用ID
    const testReferenceId = `${txHash}_0`;
    const parsed = EventIndexHelper.parseCreditReferenceId(testReferenceId);
    console.log('解析引用ID测试:', parsed);

    // 显示计数器状态
    const stats = EventIndexHelper.getCounterStats();
    console.log('计数器统计:', stats);

  } catch (error) {
    console.error('测试失败:', error);
  }
}

// 运行测试
if (require.main === module) {
  testEventIndex()
    .then(() => {
      console.log('✅ 事件索引测试完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 事件索引测试失败:', error);
      process.exit(1);
    });
}
