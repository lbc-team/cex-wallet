
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, parseEther, parseUnits, encodeAbiParameters, keccak256, serializeTransaction } from 'viem';
import { mainnet } from 'viem/chains';
import { Wallet, CreateWalletResponse, DerivationPath, SignTransactionRequest, SignTransactionResponse } from '../types/wallet';
import { DatabaseConnection } from '../db/connection';
import { SignatureValidator } from '../utils/signatureValidator';
import {
  createKeyPairSignerFromPrivateKeyBytes,
  address as solanaAddress,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  compileTransaction,
  signTransaction as solanaSignTransaction,
  getBase64EncodedWireTransaction
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { getTransferInstruction, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { derivePath } from 'ed25519-hd-key';
import bs58 from 'bs58';

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
      const riskSignValid = SignatureValidator.verifyRiskSignature(
        request.operation_id,
        request.address,
        request.to,
        request.amount,
        request.tokenAddress,
        request.chainId,
        request.nonce ?? 0,  // Solana 不使用 nonce，使用 0 作为默认值
        request.timestamp,
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
        request.operation_id,
        request.address,
        request.to,
        request.amount,
        request.tokenAddress,
        request.chainId,
        request.nonce ?? 0,  // Solana 不使用 nonce，使用 0 作为默认值
        request.timestamp,
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

      // 2. 查找地址对应的路径信息
      const addressInfo = await this.db.findAddressByAddress(request.address);
      if (!addressInfo) {
        const error = `地址 ${request.address} 未找到，请确保地址是通过此系统生成的`;
        console.error('❌ 地址查找失败:', error);
        return {
          success: false,
          error
        };
      }

      // 3. 重新生成私钥（基于路径）
      const mnemonic = this.getMnemonicFromEnv();
      const pathParts = addressInfo.path.split('/');
      const index = pathParts[pathParts.length - 1];
      console.log('📍 派生路径:', addressInfo.path);
      
      const accountData = this.createEvmAccountWithPrivateKey(mnemonic, index);
      console.log('✅ 账户数据生成完成，地址:', accountData.address);

      if (accountData.address.toLowerCase() !== request.address.toLowerCase()) {
        const error = '地址验证失败，密码可能不正确';
        console.error('❌ 地址验证失败:');
        console.error('   生成的地址:', accountData.address);
        console.error('   请求的地址:', request.address);
        return {
          success: false,
          error
        };
      }

      // 4. 创建账户对象
      const account = privateKeyToAccount(accountData.privateKey);
      console.log('✅ 签名账户地址:', account.address);

      // 5. 使用传入的 nonce（现在 nonce 是必需参数）
      const nonce = request.nonce;
      console.log('🔢 使用nonce:', nonce);

      // 7. 确定交易类型（EIP-1559 或 Legacy）
      const isEip1559 = request.type === 2;
      console.log('💡 交易类型:', isEip1559 ? 'EIP-1559' : 'Legacy', '(type=' + request.type + ')');
      
      let signedTransaction: string;
      let transactionHash: string;

      // 8. 根据链类型构建基础交易参数
      let baseTransaction: any;
      
      if (request.chainType === 'evm') {
        console.log('💰 处理EVM链交易 :', request.chainId, '代币地址:', request.tokenAddress || '原生代币');
        console.log('💵 转账金额:', request.amount);
        console.log('⛽ Gas限制:', request.gas);
        
        // EVM 链交易
        baseTransaction = {
          to: request.tokenAddress ? (request.tokenAddress as `0x${string}`) : (request.to as `0x${string}`),
          value: request.tokenAddress ? BigInt(0) : BigInt(request.amount),
          gas: request.gas ? BigInt(request.gas) : (request.tokenAddress ? BigInt(100000) : BigInt(21000)), // ERC20需要更多gas
          nonce,
          chainId: request.chainId // 使用传入的链ID
        };
        
      } else if (request.chainType === 'btc') {
        console.error('❌ Bitcoin 链签名功能尚未实现');
        return {
          success: false,
          error: 'Bitcoin 链签名功能尚未实现'
        };
      } else if (request.chainType === 'solana') {
        console.log('💰 处理 Solana 链交易:', request.chainId, '代币:', request.tokenMint || 'SOL');
        console.log('💵 转账金额:', request.amount);

        // 验证 Solana 必需参数
        if (!request.blockhash) {
          console.error('❌ 缺少 Solana blockhash 参数');
          return {
            success: false,
            error: 'Solana 交易缺少 blockhash 参数'
          };
        }

        // 1. 查找地址对应的路径信息（需要移到这里，因为 Solana 需要重新生成 signer）
        const solanaAddressInfo = await this.db.findAddressByAddress(request.address);
        if (!solanaAddressInfo) {
          const error = `地址 ${request.address} 未找到，请确保地址是通过此系统生成的`;
          console.error('❌ 地址查找失败:', error);
          return {
            success: false,
            error
          };
        }

        // 2. 重新生成 Solana signer
        const solanaMnemonic = this.getMnemonicFromEnv();
        const solanaPathParts = solanaAddressInfo.path.split('/');
        const solanaIndex = solanaPathParts[solanaPathParts.length - 1].replace("'", "");

        const solanaSeed = mnemonicToSeedSync(solanaMnemonic, this.password);
        const solanaSeedHex = Buffer.from(solanaSeed).toString('hex');
        const solanaDerivedSeed = derivePath(solanaAddressInfo.path, solanaSeedHex).key;

        const solanaSigner = await createKeyPairSignerFromPrivateKeyBytes(solanaDerivedSeed);
        console.log('✅ Solana Signer 地址:', solanaSigner.address);

        // 验证地址匹配
        if (solanaSigner.address !== request.address) {
          const error = 'Solana 地址验证失败，密码可能不正确';
          console.error('❌ 地址验证失败:');
          console.error('   生成的地址:', solanaSigner.address);
          console.error('   请求的地址:', request.address);
          return {
            success: false,
            error
          };
        }

        // 3. 构建 Solana 交易
        let instruction;

        if (request.tokenMint) {
          // SPL Token 转账
          console.log('📦 构建 SPL Token 转账指令');

          // 计算源和目标 ATA 地址
          const [sourceAta] = await findAssociatedTokenPda({
            owner: solanaAddress(request.address),
            mint: solanaAddress(request.tokenMint),
            tokenProgram: TOKEN_PROGRAM_ADDRESS
          });

          const [destAta] = await findAssociatedTokenPda({
            owner: solanaAddress(request.to),
            mint: solanaAddress(request.tokenMint),
            tokenProgram: TOKEN_PROGRAM_ADDRESS
          });

          instruction = getTransferInstruction({
            source: sourceAta,
            destination: destAta,
            authority: solanaSigner,
            amount: BigInt(request.amount)
          });
        } else {
          // SOL 原生代币转账
          console.log('💎 构建 SOL 转账指令');

          instruction = getTransferSolInstruction({
            source: solanaSigner,
            destination: solanaAddress(request.to),
            amount: BigInt(request.amount)
          });
        }

        // 4. 构建交易消息
        const transactionMessage = pipe(
          createTransactionMessage({ version: 0 }),
          tx => setTransactionMessageFeePayer(solanaSigner.address, tx),
          tx => setTransactionMessageLifetimeUsingBlockhash({
            blockhash: request.blockhash as any,  // 类型断言
            lastValidBlockHeight: BigInt(99999999)  // 使用一个大的值
          }, tx),
          tx => appendTransactionMessageInstruction(instruction, tx)
        );

        console.log('✅ Solana 交易消息构建完成');

        // 5. 编译并签名交易
        const compiledTransaction = compileTransaction(transactionMessage);
        const signedTx = await solanaSignTransaction([solanaSigner] as any, compiledTransaction);  // 类型断言

        // 6. 序列化为 base64
        signedTransaction = getBase64EncodedWireTransaction(signedTx);

        // 7. 计算交易签名（Base58 编码）
        const txSignature = signedTx.signatures[solanaSigner.address];
        if (!txSignature) {
          return {
            success: false,
            error: 'Solana 交易签名失败'
          };
        }

        // 将 Uint8Array 签名转换为 Base58
        transactionHash = bs58.encode(new Uint8Array(txSignature));

        console.log('✅ Solana 交易签名完成');
        console.log('📤 签名后的交易 (Base64):', signedTransaction.substring(0, 50) + '...');
        console.log('🔖 交易签名 (Base58):', transactionHash);

        return {
          success: true,
          data: {
            signedTransaction,
            transactionHash
          }
        };
      } else {
        console.error('❌ 不支持的链类型:', request.chainType);
        return {
          success: false,
          error: `不支持的链类型: ${request.chainType}`
        };
      }

      // 9. 添加交易数据（如果是ERC20，仅对EVM链）
      if (request.chainType === 'evm' && request.tokenAddress) {
        const encodedData = this.encodeERC20Transfer(request.to, request.amount);
        (baseTransaction as any).data = encodedData;
        console.log('✅ ERC20数据编码完成:', encodedData);
      }

      let transaction: any;

      // 10. 构建最终交易（仅对EVM链）
      if (request.chainType === 'evm') {
        if (isEip1559) {
          console.log('🚀 构建EIP-1559交易');
          // EIP-1559 交易
          const maxPriorityFee = request.maxPriorityFeePerGas 
            ? BigInt(request.maxPriorityFeePerGas) 
            : this.getDefaultPriorityFee();

          const maxFeePerGas = request.maxFeePerGas 
            ? BigInt(request.maxFeePerGas)
            : this.getDefaultMaxFeePerGas(); // 使用默认值，不联网获取

          console.log('💰 最大费用:', maxFeePerGas.toString());
          console.log('🎯 优先费用:', maxPriorityFee.toString());

          transaction = {
            ...baseTransaction,
            type: 'eip1559' as const,
            maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFee
          };
          console.log('✅ EIP-1559交易构建完成');
        } else {
          console.log('🏁 构建Legacy交易');
          // Legacy 交易
          const gasPrice = request.gasPrice 
            ? BigInt(request.gasPrice) 
            : this.getDefaultGasPrice(); // 使用默认值，不联网获取

          console.log('💰 Gas价格:', gasPrice.toString());

          transaction = {
            ...baseTransaction,
            gasPrice
          };
          console.log('✅ Legacy交易构建完成');
        }
        console.log('📝 最终交易对象:', JSON.stringify(transaction, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
      }

      // 10. 签名交易
      console.log('📝 开始签名交易...');
      signedTransaction = await account.signTransaction(transaction);
      console.log('📄 已签名交易 (前64字符):', signedTransaction.substring(0, 64) + '...');
      
      transactionHash = this.getTransactionHash(signedTransaction);
      console.log('🔑 交易哈希:', transactionHash);

      return {
        success: true,
        data: {
          signedTransaction,
          transactionHash
        }
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
