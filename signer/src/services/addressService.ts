import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { Wallet, CreateWalletRequest, CreateWalletResponse, DerivationPath } from '../types/wallet';
import { DatabaseConnection } from '../db/connection';

export class AddressService {
  private defaultDerivationPaths: DerivationPath = {
    evm: "m/44'/60'/0'/0/0",
    btc: "m/84'/1'/0'/0/0",  // BIP84 派生路径（Native SegWit 地址）
    solana: "m/44'/501'/0'/0'"
  };

  private currentIndex: number = 0;
  private password: string; // 从命令行传入的密码（必需）
  
  // 数据库连接
  private db: DatabaseConnection;

  constructor(password: string) {
    if (!password) {
      throw new Error('密码是必需的参数');
    }
    this.password = password;
    this.currentIndex = 0; // 初始化默认值
    // 初始化数据库连接
    this.db = new DatabaseConnection();
  }

  /**
   * 初始化服务（等待数据库初始化并加载配置）
   */
  async initialize(): Promise<void> {
    try {
      // 等待数据库初始化完成
      await this.db.waitForInitialization();
      
      // 加载配置（包括 currentIndex）
      await this.loadConfig();
      
      console.log('AddressService 初始化完成');
    } catch (error) {
      console.error('AddressService 初始化失败:', error);
      throw error;
    }
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
   * 使用密码创建账户（支持 BIP39 passphrase）
   */
  private createAccountWithPassword(mnemonic: string, index: string): any {
    const fullPath = `m/44'/60'/0'/0/${index}`;
    
    // 使用密码生成种子
    const seed = mnemonicToSeedSync(mnemonic, this.password);
    
    // 从种子创建 HD 密钥
    const hdKey = HDKey.fromMasterSeed(seed);
    
    // 派生到指定路径
    const derivedKey = hdKey.derive(fullPath);
    
    if (!derivedKey.privateKey) {
      throw new Error('无法派生私钥');
    }
    
    // 从私钥创建账户（转换为十六进制字符串）
    const privateKeyHex = `0x${Buffer.from(derivedKey.privateKey).toString('hex')}`;
    const account = privateKeyToAccount(privateKeyHex as `0x${string}`);
    
    // 返回账户信息
    return {
      address: account.address,
      privateKey: derivedKey.privateKey,
      path: fullPath
    };
  }

  /**
   * 等待数据库初始化完成
   */
  private async waitForDatabaseInitialization(): Promise<void> {
    console.log('等待数据库初始化...');
    await this.db.waitForInitialization();
    console.log('数据库初始化完成');
  }

  /**
   * 验证密码正确性
   */
  async validatePassword(): Promise<boolean> {
    try {
      // 等待数据库初始化完成
      await this.waitForDatabaseInitialization();
      // 获取第一个生成的地址（用于密码验证）
      const firstAddressData = await this.db.getFirstGeneratedAddress();
      console.log('获取第一个生成的地址完成:', firstAddressData);
      
      if (!firstAddressData) {
        // 第一次启动，创建第一个地址作为验证基准
        console.log('首次启动，正在创建验证地址...');
        await this.createValidationAddress();
        return true;
      }

      // 使用当前密码和相同的路径生成地址
      const mnemonic = this.getMnemonicFromEnv();
      const validationPath = firstAddressData.path; // 使用相同的路径
      
      // 从路径中提取索引（最后一部分）
      const pathParts = validationPath.split('/');
      const index = pathParts[pathParts.length - 1];
      
      const validationAccount = this.createAccountWithPassword(mnemonic, index);
      
      // 比较生成的地址与存储的地址
      if (validationAccount.address === firstAddressData.address) {
        console.log('密码验证成功');
        return true;
      } else {
        console.error('密码验证失败');
        return false;
      }
      
    } catch (error) {
      console.error('密码验证过程中发生错误:', error);
      return false;
    }
  }

  /**
   * 创建验证地址
   */
  private async createValidationAddress(): Promise<void> {
    try {
      const mnemonic = this.getMnemonicFromEnv();
      const validationIndex = "0"; // 验证地址使用索引 0
      
      const validationAccount = this.createAccountWithPassword(mnemonic, validationIndex);
      
      // 构建完整路径用于存储
      const validationPath = `m/44'/60'/0'/0/${validationIndex}`;
      
      // 保存验证地址到数据库，使用 currentIndex = 0
      await this.db.addGeneratedAddress(validationAccount.address, validationPath, 0, 'evm');
      
      console.log(`验证地址已创建: ${validationAccount.address}`);
      console.log('注意: 请妥善保管您的密码');
      
    } catch (error) {
      console.error('创建验证地址失败:', error);
      throw error;
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
  private async saveGeneratedAddress(address: string, path: string, index: number, chainType: string): Promise<void> {
    try {
      await this.db.addGeneratedAddress(address, path, index, chainType);
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
      // let privateKey: string;

      switch (chainType) {
        case 'evm':
          // 使用密码进行助记词派生
          // 从路径中提取索引（最后一部分）
          const pathParts = derivationPath.split('/');
          const index = pathParts[pathParts.length - 1];
          
          const accountData = this.createAccountWithPassword(mnemonic, index);
          account = {
            address: accountData.address,
            source: accountData.privateKey
          };
          console.log('accountData', { address: accountData.address, path: accountData.path });
          // privateKey = account.source;
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
        // privateKey: privateKey,
        device: device,
        path: derivationPath,
        chainType: chainType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // 从路径中提取索引
      const pathParts = derivationPath.split('/');
      const index = parseInt(pathParts[pathParts.length - 1]);
      
      // 保存地址并更新索引
      await this.saveAddressAndUpdateIndex(account.address, derivationPath, index, chainType);

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
      
      // 使用当前的 currentIndex 作为下一个索引
      const nextIndex = this.currentIndex;
      pathParts[pathParts.length - 1] = nextIndex.toString();
      
      return pathParts.join('/');
    }
    
    // 对于其他链类型，暂时返回基础路径
    return basePath;
  }

  /**
   * 保存地址并更新索引
   */
  private async saveAddressAndUpdateIndex(address: string, path: string, index: number, chainType: string): Promise<void> {
    try {
      // 保存地址到数据库
      await this.db.addGeneratedAddress(address, path, index, chainType);
      
      // 更新 currentIndex 为下一个值
      this.currentIndex = index + 1;
      
      // 保存更新后的索引到数据库
      await this.saveCurrentIndex();
      
      console.log(`地址已保存: ${address}, 索引: ${index}, 链类型: ${chainType}, 下一个索引: ${this.currentIndex}`);
    } catch (error) {
      console.error('保存地址和更新索引失败:', error);
      throw error;
    }
  }


}
