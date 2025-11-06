import { IWithdrawHandler } from './types';
import { EvmWithdrawHandler } from './evmHandler';
import { SolanaWithdrawHandler } from './solanaHandler';
import { GasEstimationService } from '../../utils/gasEstimation';
import { HotWalletService } from '../hotWalletService';

/**
 * 提现处理器工厂
 * 根据链类型返回对应的处理器实例
 */
export class WithdrawHandlerFactory {
  private evmHandler: EvmWithdrawHandler;
  private solanaHandler: SolanaWithdrawHandler;

  constructor(
    gasEstimationService: GasEstimationService,
    hotWalletService: HotWalletService
  ) {
    this.evmHandler = new EvmWithdrawHandler(gasEstimationService, hotWalletService);
    this.solanaHandler = new SolanaWithdrawHandler();
  }

  /**
   * 获取对应链类型的提现处理器
   */
  getHandler(chainType: 'evm' | 'btc' | 'solana'): IWithdrawHandler {
    switch (chainType) {
      case 'evm':
        return this.evmHandler;
      case 'solana':
        return this.solanaHandler;
      case 'btc':
        // TODO: 实现 BTC 处理器
        throw new Error('BTC 提现处理器尚未实现');
      default:
        throw new Error(`不支持的链类型: ${chainType}`);
    }
  }
}
