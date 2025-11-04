
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { privateKeyToAccount } from 'viem/accounts';
import { Wallet, CreateWalletResponse, DerivationPath, SignTransactionRequest, SignTransactionResponse } from '../types/wallet';
import { DatabaseConnection } from '../db/connection';
import { SignatureValidator } from '../utils/signatureValidator';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import { derivePath } from 'ed25519-hd-key';
import { signEvmTransaction } from './signers/evmSigner';
import { signSolanaTransaction } from './signers/solanaSigner';
import { signBtcTransaction } from './signers/btcSigner';

export class AddressService {
  private defaultDerivationPaths: DerivationPath = {
    evm: "m/44'/60'/0'/0/0",
    btc: "m/84'/1'/0'/0/0",  // BIP84 派生路径（Native SegWit 地址）
    solana: "m/44'/501'/0'/0'"
  };

  private password: string; // 从命令行传入的密码（必需）

  // 数据库连接
  private db: DatabaseConnection;

  // 公钥配置（用于签名验证）
  private riskPublicKey: string;
  private walletPublicKey: string;

  constructor(password: string) {
    if (!password) {
      throw new Error('密码是必需的参数');
    }
    this.password = password;
    // 初始化数据库连接
    this.db = new DatabaseConnection();

    // 加载公钥配置
    const riskPublicKey = process.env.RISK_PUBLIC_KEY;
    const walletPublicKey = process.env.WALLET_PUBLIC_KEY;

    if (!riskPublicKey || !walletPublicKey) {
      throw new Error('签名验证配置缺失: RISK_PUBLIC_KEY 和 WALLET_PUBLIC_KEY 必须配置');
    }

    this.riskPublicKey = riskPublicKey;
    this.walletPublicKey = walletPublicKey;
  }

  /**
   * 初始化服务（等待数据库初始化）
   */
  async initialize(): Promise<void> {
    try {
      // 等待数据库初始化完成
      await this.db.waitForInitialization();
      
      console.log('AddressService 初始化完成');
    } catch (error) {
      console.error('AddressService 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 使用密码创建账户（支持 BIP39 passphrase）
   */
  private createEvmAccount(mnemonic: string, index: string): any {
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
      // privateKey: derivedKey.privateKey,
      path: fullPath
    };
  }

  /**
   * 创建 Solana 账户
   */
  private async createSolanaAccount(mnemonic: string, index: string): Promise<any> {
    const fullPath = `m/44'/501'/0'/${index}'`;

    // 使用密码生成种子
    const seed = mnemonicToSeedSync(mnemonic, this.password);

    // 使用 ed25519-hd-key 派生 Solana 密钥
    // derivePath 期望传入十六进制字符串
    const seedHex = Buffer.from(seed).toString('hex');
    const derivedSeed = derivePath(fullPath, seedHex).key;

    // 从派生的 32 字节私钥创建 Signer (使用 @solana/kit)
    const signer = await createKeyPairSignerFromPrivateKeyBytes(derivedSeed);

    // 返回账户信息
    return {
      address: signer.address,
      path: fullPath
    };
  }

  /**
   * 等待数据库初始化完成
   */
  private async waitForDatabaseInitialization(): Promise<void> {
    await this.db.waitForInitialization();
  }

  /**
   * 验证密码正确性
   */
  async validatePassword(): Promise<boolean> {
    try {
      // 等待数据库初始化完成
      await this.waitForDatabaseInitialization();
      
      // 获取 EVM 链的最大索引
      const maxIndex = await this.db.getMaxIndexForChain('evm');
      
      if (maxIndex === -1) {
        // 没有记录，创建验证地址
        console.log('首次启动，正在创建验证地址...');
        await this.createValidationAddress();
        return true;
      } else {
        // 有记录，验证第一个地址
        const firstAddressData = await this.db.getFirstGeneratedAddress();
        console.log('获取第一个生成的地址完成:', firstAddressData);
        
        if (!firstAddressData) {
          console.error('数据库中有记录但无法获取第一个地址');
          return false;
        }

        // 使用当前密码和相同的路径生成地址
        const mnemonic = this.getMnemonicFromEnv();
        const validationPath = firstAddressData.path;
        
        // 从路径中提取索引（最后一部分）
        const pathParts = validationPath.split('/');
        const index = pathParts[pathParts.length - 1];
        
        const validationAccount = this.createEvmAccount(mnemonic, index);
        
        // 比较生成的地址与存储的地址
        if (validationAccount.address === firstAddressData.address) {
          console.log('密码验证成功');
          return true;
        } else {
          console.error('密码验证失败');
          return false;
        }
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
      
      const validationAccount = this.createEvmAccount(mnemonic, validationIndex);
      
      // 构建完整路径用于存储
      const validationPath = `m/44'/60'/0'/0/${validationIndex}`;
      
      // 保存验证地址到数据库，使用 currentIndex = 0
      await this.db.addGeneratedAddress(validationAccount.address, validationPath, 0, 'evm');
      
      console.log(`验证地址已创建: ${validationAccount.address}`);
      
    } catch (error) {
      console.error('创建验证地址失败:', error);
      throw error;
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
   * 创建新钱包 
   */
  async createNewWallet(chainType: 'evm' | 'btc' | 'solana'): Promise<CreateWalletResponse> {
    try {
      // 从环境变量获取助记词
      const mnemonic = this.getMnemonicFromEnv();
      
      if (!mnemonic) {
        return {
          success: false,
          error: '助记词不能为空'
        };
      }

      // 从环境变量获取设备名
      const device = process.env.SIGNER_DEVICE || 'signer_device1';
      
      // 根据链类型生成新的派生路径
      const derivationPath = await this.generateNextDerivationPath(chainType);

      // 根据链类型创建账户
      let account;

      switch (chainType) {
        case 'evm':
          const evmPathParts = derivationPath.split('/');
          const evmIndex = evmPathParts[evmPathParts.length - 1];

          const evmAccountData = this.createEvmAccount(mnemonic, evmIndex);
          account = {
            address: evmAccountData.address,
          };
          console.log('EVM accountData', { address: evmAccountData.address, path: evmAccountData.path });
          break;
        case 'btc':
          // 比特币钱包创建（ 未来支持：bitcoinjs-lib bip39 tiny-secp256k1）
          return {
            success: false,
            error: '比特币钱包创建暂未实现'
          };
        case 'solana':
          // Solana钱包创建
          const solanaPathParts = derivationPath.split('/');
          const solanaIndex = solanaPathParts[solanaPathParts.length - 1].replace("'", "");

          const solanaAccountData = await this.createSolanaAccount(mnemonic, solanaIndex);
          account = {
            address: solanaAccountData.address,
          };
          console.log('Solana accountData', { address: solanaAccountData.address, path: solanaAccountData.path });
          break;
        default:
          return {
            success: false,
            error: '不支持的链类型'
          };
      }

      const wallet: Wallet = {
        address: account.address,
        device: device,
        path: derivationPath,
        chainType: chainType,
        createdAt: new Date().toISOString()
      };

      // 从路径中提取索引
      const pathParts = derivationPath.split('/');
      const index = parseInt(pathParts[pathParts.length - 1]);
      
      // 保存地址
      await this.saveAddress(account.address, derivationPath, index, chainType);

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
   * 获取下一个派生路径
   */
  private async generateNextDerivationPath(chainType: 'evm' | 'btc' | 'solana'): Promise<string> {
    const basePath = this.defaultDerivationPaths[chainType];

    // 对于 EVM，修改路径的最后一位
    if (chainType === 'evm') {
      const pathParts = basePath.split('/');

      // 获取当前链类型的最大索引
      const maxIndex = await this.db.getMaxIndexForChain(chainType);
      const nextIndex = maxIndex + 1;

      pathParts[pathParts.length - 1] = nextIndex.toString();
      return pathParts.join('/');
    }

    // 对于 Solana，修改路径的最后一位（hardened derivation）
    if (chainType === 'solana') {
      const pathParts = basePath.split('/');

      // 获取当前链类型的最大索引
      const maxIndex = await this.db.getMaxIndexForChain(chainType);
      const nextIndex = maxIndex + 1;

      pathParts[pathParts.length - 1] = `${nextIndex}'`;
      return pathParts.join('/');
    }

    // 对于其他链类型，暂时返回基础路径
    return basePath;
  }

  /**
   * 保存地址
   */
  private async saveAddress(address: string, path: string, index: number, chainType: string): Promise<void> {
    try {
      // 保存地址到数据库
      await this.db.addGeneratedAddress(address, path, index, chainType);
      
      console.log(`地址已保存: ${address}, 索引: ${index}, 链类型: ${chainType}`);
    } catch (error) {
      console.error('保存地址失败:', error);
      throw error;
    }
  }

  /**
   * 签名交易
   */
  async signTransaction(request: SignTransactionRequest): Promise<SignTransactionResponse> {
    console.log('📥 签名参数:', JSON.stringify(request, null, 2));

    try {
      // 1. 验证请求参数
      if (!request.address || !request.to || !request.amount) {
        const error = '缺少必需参数: address, to, amount';
        console.error('❌ 参数验证失败:', error);
        return {
          success: false,
          error
        };
      }

      // 2. 验证双重签名（必须项）
      if (!request.operation_id || !request.timestamp || !request.risk_signature || !request.wallet_signature) {
        const error = '缺少必需的签名参数: operation_id, timestamp, risk_signature, wallet_signature';
        console.error('❌', error);
        return {
          success: false,
          error
        };
      }

      console.log('🔐 开始验证双重签名...');

      // 验证时间戳有效性（1分钟内）
      const currentTime = Date.now();
      const timeDiff = Math.abs(currentTime - request.timestamp);
      const maxTimeDiff = 60 * 1000; // 60秒

      if (timeDiff > maxTimeDiff) {
        const error = `签名已过期: 时间差 ${Math.floor(timeDiff / 1000)} 秒 (最大允许 ${maxTimeDiff / 1000} 秒)`;
        console.error('❌', error);
        return {
          success: false,
          error
        };
      }

      console.log('✅ 时间戳验证通过');

      // 验证风控签名（使用构造函数中加载的公钥）
      const signatureParams = {
        operationId: request.operation_id,
        chainType: request.chainType,
        from: request.address,
        to: request.to,
        amount: request.amount,
        tokenAddress: request.tokenAddress,
        tokenType: request.tokenType,
        chainId: request.chainId,
        nonce: request.nonce ?? 0,
        blockhash: request.blockhash,
        lastValidBlockHeight: request.lastValidBlockHeight,
        fee: request.fee,
        timestamp: request.timestamp
      };

      console.log('📋 Signer 验证参数:', JSON.stringify(signatureParams, null, 2));

      const riskSignValid = SignatureValidator.verifyRiskSignature(
        signatureParams,
        request.risk_signature,
        this.riskPublicKey
      );

      if (!riskSignValid) {
        const error = '风控签名验证失败';
        console.error('❌', error);
        return {
          success: false,
          error
        };
      }

      console.log('✅ 风控签名验证通过');

      // 验证 wallet 服务签名（使用构造函数中加载的公钥）
      const walletSignValid = SignatureValidator.verifyWalletSignature(
        signatureParams,
        request.wallet_signature,
        this.walletPublicKey
      );

      if (!walletSignValid) {
        const error = 'Wallet 服务签名验证失败';
        console.error('❌', error);
        return {
          success: false,
          error
        };
      }

      console.log('✅ Wallet 服务签名验证通过');
      console.log('✅ 双重签名验证全部通过');

      if (request.chainType === 'evm') {
        const mnemonic = this.getMnemonicFromEnv();
        return signEvmTransaction(request, {
          db: this.db,
          mnemonic,
          password: this.password
        });
      }

      if (request.chainType === 'solana') {
        const mnemonic = this.getMnemonicFromEnv();
        return signSolanaTransaction(request, {
          db: this.db,
          mnemonic,
          password: this.password
        });
      }

      if (request.chainType === 'btc') {
        return signBtcTransaction();
      }

      console.error('❌ 不支持的链类型:', request.chainType);
      return {
        success: false,
        error: `不支持的链类型: ${request.chainType}`
      };

    } catch (error) {
      console.error('❌ 交易签名失败:');
      console.error('📍 错误详情:', error);
      console.error('📋 错误类型:', typeof error);
      console.error('📝 错误消息:', error instanceof Error ? error.message : String(error));
      console.error('📚 错误堆栈:', error instanceof Error ? error.stack : 'No stack trace');
      
      return {
        success: false,
        error: `交易签名失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

}
