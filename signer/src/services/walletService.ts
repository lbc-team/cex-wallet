import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mnemonicToAccount } from 'viem/accounts';
import { generateMnemonic } from 'viem/accounts';
import { english } from 'viem/accounts';
import { Wallet, CreateWalletRequest, CreateWalletResponse, MnemonicOptions, DerivationPath } from '../types/wallet';

export class WalletService {
  private defaultDerivationPaths: DerivationPath = {
    evm: "m/44'/60'/0'/0/0",
    btc: "m/84'/1'/0'/0/0",  // BIP84 派生路径（Native SegWit 地址）
    solana: "m/44'/501'/0'/0'"
  };

  /**
   * 生成助记词
   */
  generateMnemonic(options: MnemonicOptions = {}): string {
    const { strength = 256, language = 'english' } = options;
    return generateMnemonic(english, strength);
  }

  /**
   * 从助记词创建钱包
   */
  createWalletFromMnemonic(request: CreateWalletRequest): CreateWalletResponse {
    try {
      const { device, path, chainType, mnemonic } = request;
      
      if (!mnemonic) {
        return {
          success: false,
          error: '助记词不能为空'
        };
      }

      // 使用提供的路径或默认路径
      const derivationPath = path || this.defaultDerivationPaths[chainType];

      // 根据链类型创建账户
      let account;
      let privateKey: string;

      switch (chainType) {
        case 'evm':
          account = mnemonicToAccount(mnemonic, { path: derivationPath as `m/44'/60'/${string}` });
          privateKey = account.source;
          break;
        case 'btc':
          // 比特币钱包创建（这里简化处理，实际项目中需要专门的比特币库：bitcoinjs-lib bip39 tiny-secp256k1）
          return {
            success: false,
            error: '比特币钱包创建暂未实现'
          };
        case 'solana':
          // Solana钱包创建（这里简化处理，实际项目中需要专门的Solana库）
          return {
            success: false,
            error: 'Solana钱包创建暂未实现'
          };
        default:
          return {
            success: false,
            error: '不支持的链类型'
          };
      }

      const wallet: Wallet = {
        address: account.address,
        privateKey: privateKey,
        device: device,
        path: derivationPath,
        chainType: chainType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      return {
        success: true,
        data: wallet
      };

    } catch (error) {
      return {
        success: false,
        error: `钱包创建失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 创建新钱包（生成新的助记词）
   */
  createNewWallet(request: CreateWalletRequest): CreateWalletResponse {
    try {
      // 生成新的助记词
      const mnemonic = this.generateMnemonic();
      
      // 使用生成的助记词创建钱包
      return this.createWalletFromMnemonic({
        ...request,
        mnemonic: mnemonic
      });

    } catch (error) {
      return {
        success: false,
        error: `钱包创建失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 从私钥创建钱包
   */
  createWalletFromPrivateKey(privateKey: string, device: string, chainType: 'evm' | 'btc' | 'solana'): CreateWalletResponse {
    try {
      if (chainType !== 'evm') {
        return {
          success: false,
          error: '目前只支持从私钥创建EVM钱包'
        };
      }

      const account = privateKeyToAccount(privateKey as `0x${string}`);

      const wallet: Wallet = {
        address: account.address,
        privateKey: privateKey,
        device: device,
        path: this.defaultDerivationPaths.evm,
        chainType: chainType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      return {
        success: true,
        data: wallet
      };

    } catch (error) {
      return {
        success: false,
        error: `从私钥创建钱包失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 验证钱包地址
   */
  validateAddress(address: string, chainType: 'evm' | 'btc' | 'solana'): boolean {
    try {
      switch (chainType) {
        case 'evm':
          // 以太坊地址验证
          return /^0x[a-fA-F0-9]{40}$/.test(address);
        case 'btc':
          // 比特币地址验证（简化）
          return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) || /^bc1[a-z0-9]{39,59}$/.test(address);
        case 'solana':
          // Solana地址验证（简化）
          return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * 获取默认派生路径
   */
  getDefaultDerivationPath(chainType: 'evm' | 'btc' | 'solana'): string {
    return this.defaultDerivationPaths[chainType];
  }
}
