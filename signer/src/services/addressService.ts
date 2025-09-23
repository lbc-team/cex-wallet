
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, parseEther, parseUnits, encodeAbiParameters, keccak256, serializeTransaction } from 'viem';
import { mainnet } from 'viem/chains';
import { Wallet, CreateWalletResponse, DerivationPath, SignTransactionRequest, SignTransactionResponse } from '../types/wallet';
import { DatabaseConnection } from '../db/connection';

export class AddressService {
  private defaultDerivationPaths: DerivationPath = {
    evm: "m/44'/60'/0'/0/0",
    btc: "m/84'/1'/0'/0/0",  // BIP84 派生路径（Native SegWit 地址）
    solana: "m/44'/501'/0'/0'"
  };

  private password: string; // 从命令行传入的密码（必需）
  
  // 数据库连接
  private db: DatabaseConnection;

  constructor(password: string) {
    if (!password) {
      throw new Error('密码是必需的参数');
    }
    this.password = password;
    // 初始化数据库连接
    this.db = new DatabaseConnection();
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
          const pathParts = derivationPath.split('/');
          const index = pathParts[pathParts.length - 1];
          
          const accountData = this.createEvmAccount(mnemonic, index);
          account = {
            address: accountData.address,
          };
          console.log('accountData', { address: accountData.address, path: accountData.path });
          break;
        case 'btc':
          // 比特币钱包创建（ 未来支持：bitcoinjs-lib bip39 tiny-secp256k1）
          return {
            success: false,
            error: '比特币钱包创建暂未实现'
          };
        case 'solana':
          // Solana钱包创建 
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
    try {
      // 1. 验证请求参数
      if (!request.address || !request.to || !request.amount) {
        return {
          success: false,
          error: '缺少必需参数: address, to, amount'
        };
      }

      // 2. 查找地址对应的路径信息
      const addressInfo = await this.db.findAddressByAddress(request.address);
      if (!addressInfo) {
        return {
          success: false,
          error: `地址 ${request.address} 未找到，请确保地址是通过此系统生成的`
        };
      }

      // 3. 重新生成私钥（基于路径）
      const mnemonic = this.getMnemonicFromEnv();
      const pathParts = addressInfo.path.split('/');
      const index = pathParts[pathParts.length - 1];
      const accountData = this.createEvmAccountWithPrivateKey(mnemonic, index);

      if (accountData.address.toLowerCase() !== request.address.toLowerCase()) {
        return {
          success: false,
          error: '地址验证失败，密码可能不正确'
        };
      }

      // 4. 创建账户对象
      const account = privateKeyToAccount(accountData.privateKey);

      // 5. 使用传入的 nonce（现在 nonce 是必需参数）
      const nonce = request.nonce;

      // 7. 确定交易类型（EIP-1559 或 Legacy）
      const isEip1559 = request.type !== 0 && (request.maxFeePerGas || request.maxPriorityFeePerGas);
      
      let signedTransaction: string;
      let transactionHash: string;

      // 8. 根据链类型构建基础交易参数
      let baseTransaction: any;
      
      if (request.chainType === 'evm') {
        // EVM 链交易
        baseTransaction = {
          to: request.tokenAddress ? (request.tokenAddress as `0x${string}`) : (request.to as `0x${string}`),
          value: request.tokenAddress ? 0n : BigInt(request.amount),
          gas: request.gas ? BigInt(request.gas) : (request.tokenAddress ? 100000n : 21000n), // ERC20需要更多gas
          nonce,
          chainId: request.chainId // 使用传入的链ID
        };
      } else if (request.chainType === 'btc') {
        // Bitcoin 交易（暂时返回错误，需要实现 BTC 签名逻辑）
        return {
          success: false,
          error: 'Bitcoin 链签名功能尚未实现'
        };
      } else if (request.chainType === 'solana') {
        // Solana 交易（暂时返回错误，需要实现 Solana 签名逻辑）
        return {
          success: false,
          error: 'Solana 链签名功能尚未实现'
        };
      } else {
        return {
          success: false,
          error: `不支持的链类型: ${request.chainType}`
        };
      }

      // 9. 添加交易数据（如果是ERC20，仅对EVM链）
      if (request.chainType === 'evm' && request.tokenAddress) {
        (baseTransaction as any).data = this.encodeERC20Transfer(request.to, request.amount);
      }

      let transaction: any;

      // 10. 构建最终交易（仅对EVM链）
      if (request.chainType === 'evm') {
        if (isEip1559) {
          // EIP-1559 交易
          const maxPriorityFee = request.maxPriorityFeePerGas 
            ? BigInt(request.maxPriorityFeePerGas) 
            : this.getDefaultPriorityFee();

          const maxFeePerGas = request.maxFeePerGas 
            ? BigInt(request.maxFeePerGas)
            : this.getDefaultMaxFeePerGas(); // 使用默认值，不联网获取

          transaction = {
            ...baseTransaction,
            type: 2 as const, // EIP-1559
            maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFee
          };
        } else {
          // Legacy 交易
          const gasPrice = request.gasPrice 
            ? BigInt(request.gasPrice) 
            : this.getDefaultGasPrice(); // 使用默认值，不联网获取

          transaction = {
            ...baseTransaction,
            type: 0 as const, // Legacy
            gasPrice
          };
        }
      }

      // 10. 签名交易
      signedTransaction = await account.signTransaction(transaction);
      transactionHash = this.getTransactionHash(signedTransaction);

      return {
        success: true,
        data: {
          signedTransaction,
          transactionHash
        }
      };

    } catch (error) {
      console.error('交易签名失败:', error);
      return {
        success: false,
        error: `交易签名失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 创建EVM账户并包含私钥（仅用于签名）
   */
  private createEvmAccountWithPrivateKey(mnemonic: string, index: string): { address: string; privateKey: `0x${string}` } {
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
    const privateKeyHex = `0x${Buffer.from(derivedKey.privateKey).toString('hex')}` as `0x${string}`;
    const account = privateKeyToAccount(privateKeyHex);
    
    return {
      address: account.address,
      privateKey: privateKeyHex
    };
  }

  /**
   * 编码 ERC20 transfer 方法调用
   */
  private encodeERC20Transfer(to: string, amount: string): `0x${string}` {
    // ERC20 transfer 方法签名: transfer(address,uint256)
    const methodId = '0xa9059cbb'; // keccak256('transfer(address,uint256)').slice(0, 8)
    
    const encodedParams = encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' }
      ],
      [to as `0x${string}`, BigInt(amount)]
    );
    
    return `${methodId}${encodedParams.slice(2)}` as `0x${string}`;
  }

  /**
   * 计算交易哈希
   */
  private getTransactionHash(signedTransaction: string): string {
    // 对于已签名的交易，我们可以使用 keccak256 计算哈希
    return keccak256(signedTransaction as `0x${string}`);
  }

  /**
   * 获取默认优先费用（矿工小费）
   */
  private getDefaultPriorityFee(): bigint {
    // 默认设置为 2 Gwei 的优先费用
    // 在实际应用中，可以根据网络拥堵情况动态调整
    return parseUnits('2', 9); // 2 Gwei = 2 * 10^9 wei
  }

  /**
   * 获取默认最大费用（EIP-1559）
   */
  private getDefaultMaxFeePerGas(): bigint {
    // 默认设置为 30 Gwei 的最大费用
    // 包含基础费用和优先费用
    return parseUnits('30', 9); // 30 Gwei = 30 * 10^9 wei
  }

  /**
   * 获取默认 Gas 价格（Legacy 交易）
   */
  private getDefaultGasPrice(): bigint {
    // 默认设置为 25 Gwei 的 gas 价格
    return parseUnits('25', 9); // 25 Gwei = 25 * 10^9 wei
  }

}
