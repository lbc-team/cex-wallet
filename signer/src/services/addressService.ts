import { mnemonicToAccount } from 'viem/accounts';
import { Wallet, CreateWalletRequest, CreateWalletResponse, DerivationPath } from '../types/wallet';
import { DatabaseConnection } from '../db/connection';

export class AddressService {
  private defaultDerivationPaths: DerivationPath = {
    evm: "m/44'/60'/0'/0/0",
    btc: "m/84'/1'/0'/0/0",  // BIP84 派生路径（Native SegWit 地址）
    solana: "m/44'/501'/0'/0'"
  };

  private currentIndex: number = 0;
  
  // 数据库连接
  private db: DatabaseConnection;

  constructor() {
    // 初始化数据库连接
    this.db = new DatabaseConnection();
    // 延迟加载配置，确保数据库表已创建
    setTimeout(() => {
      this.loadConfig();
    }, 100);
  }

  /**
   * 加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      // 从数据库加载当前索引
      this.currentIndex = await this.db.getCurrentIndex();
      
      console.log(`配置加载完成 - 当前索引: ${this.currentIndex}`);
    } catch (error) {
      console.warn('加载配置失败，使用默认配置:', error);
    }
  }

  /**
   * 保存当前索引到数据库
   */
  private async saveCurrentIndex(): Promise<void> {
    try {
      await this.db.updateCurrentIndex(this.currentIndex);
    } catch (error) {
      console.error('保存当前索引失败:', error);
    }
  }

  /**
   * 保存生成的地址到数据库
   */
  private async saveGeneratedAddress(address: string, path: string, index: number): Promise<void> {
    try {
      await this.db.addGeneratedAddress(address, path, index);
    } catch (error) {
      console.error('保存生成地址失败:', error);
    }
  }

  // 从环境变量获取助记词
  private getMnemonicFromEnv(): string {
    const mnemonic = process.env.MNEMONIC;
    if (!mnemonic) {
      throw new Error('环境变量 MNEMONIC 未设置');
    }
    return mnemonic;
  }


  /**
   * 从助记词创建钱包
   */
  async createWalletFromMnemonic(request: CreateWalletRequest): Promise<CreateWalletResponse> {
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

      // 保存生成的地址到数据库
      await this.saveGeneratedAddress(account.address, derivationPath, this.currentIndex - 1);

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
   * 创建新钱包（使用环境变量中的助记词）
   */
  async createNewWallet(chainType: 'evm' | 'btc' | 'solana'): Promise<CreateWalletResponse> {
    try {
      // 从环境变量获取助记词
      const mnemonic = this.getMnemonicFromEnv();
      
      // 从环境变量获取设备名
      const device = process.env.SIGNER_DEVICE || 'signer_device1';
      
      // 根据链类型生成新的派生路径
      const derivationPath = await this.generateNextDerivationPath(chainType);
      
      // 使用助记词和新的派生路径创建钱包
      return await this.createWalletFromMnemonic({
        device,
        chainType,
        mnemonic: mnemonic,
        path: derivationPath
      });

    } catch (error) {
      return {
        success: false,
        error: `钱包创建失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 生成下一个派生路径
   */
  private async generateNextDerivationPath(chainType: 'evm' | 'btc' | 'solana'): Promise<string> {
    const basePath = this.defaultDerivationPaths[chainType];
    
    // 对于 EVM，修改路径的最后一位
    if (chainType === 'evm') {
      const pathParts = basePath.split('/');
      pathParts[pathParts.length - 1] = this.currentIndex.toString();
      this.currentIndex++;
      
      // 保存当前索引到数据库
      await this.saveCurrentIndex();
      
      return pathParts.join('/');
    }
    
    // 对于其他链类型，暂时返回基础路径
    return basePath;
  }


}
