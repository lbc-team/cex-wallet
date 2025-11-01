import { walletDAO, tokenDAO, solanaTokenAccountDAO } from '../db/models';
import { getDbGatewayClient } from './dbGatewayClient';
import logger from '../utils/logger';

// SPL Token Program IDs
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

export interface ParsedDeposit {
  txHash: string;
  slot: number;
  fromAddr?: string;
  toAddr: string;
  tokenMint?: string;
  amount: string;
  type: 'sol' | 'spl-token' | 'spl-token-2022';
  userId?: number;
  tokenId?: number;
  blockTime?: number;
  status: 'confirmed' | 'finalized';
}

export class TransactionParser {
  private dbGatewayClient = getDbGatewayClient();
  private monitoredAddresses: Set<string> = new Set();
  private tokenMintMap: Map<string, any> = new Map();
  private ataToWalletMap: Map<string, string> = new Map(); // ATA地址 -> 钱包地址映射
  private lastAddressUpdate: number = 0;
  private lastTokenUpdate: number = 0;
  private lastATAUpdate: number = 0;

  constructor() {
    // 缓存会在 scanService.start 中显式刷新，确保数据库连接已建立
  }

  /**
   * 刷新监控地址和代币缓存
   */
  async refreshCache(): Promise<void> {
    try {
      logger.info('刷新监控地址和代币缓存...');

      // 获取所有Solana钱包地址
      const addresses = await walletDAO.getAllSolanaWalletAddresses();
      this.monitoredAddresses = new Set(addresses.map(addr => addr.toLowerCase()));

      // 获取所有Solana代币
      const tokens = await tokenDAO.getAllSolanaTokens();
      this.tokenMintMap.clear();
      for (const token of tokens) {
        if (token.token_address) {
          this.tokenMintMap.set(token.token_address.toLowerCase(), token);
        }
      }

      // 获取ATA到钱包地址的映射
      this.ataToWalletMap = await solanaTokenAccountDAO.getATAToWalletMap();

      this.lastAddressUpdate = Date.now();
      this.lastTokenUpdate = Date.now();
      this.lastATAUpdate = Date.now();

      // 打印前3条ATA映射用于调试
      const ataEntries = Array.from(this.ataToWalletMap.entries()).slice(0, 3);

      logger.info('缓存刷新完成', {
        addressCount: this.monitoredAddresses.size,
        tokenCount: this.tokenMintMap.size,
        ataCount: this.ataToWalletMap.size,
        sampleATAMappings: ataEntries.map(([ata, wallet]) => ({ ata, wallet })),
        sampleAddresses: Array.from(this.monitoredAddresses).slice(0, 3)
      });
    } catch (error) {
      logger.error('刷新缓存失败', { error });
      throw error;
    }
  }

  /**
   * 解析区块中的交易
   */
  async parseBlock(block: any, slot: number, status: 'confirmed' | 'finalized' = 'confirmed'): Promise<ParsedDeposit[]> {
    if (!block || !block.transactions) {
      return [];
    }

    const deposits: ParsedDeposit[] = [];

    // 将 blockTime 转换为 number（处理 BigInt 情况）
    const blockTime = block.blockTime ? Number(block.blockTime) : undefined;

    logger.debug(`解析区块 ${slot}，交易数量: ${block.transactions.length}`);

    for (const tx of block.transactions) {
      try {
        const parsedDeposits = await this.parseTransaction(tx, slot, blockTime, status);
        if (parsedDeposits.length > 0) {
          logger.debug(`槽位 ${slot} 发现 ${parsedDeposits.length} 笔存款`, {
            types: parsedDeposits.map(d => d.type)
          });
        }
        deposits.push(...parsedDeposits);
      } catch (error) {
        logger.error('解析交易失败', { slot, error });
      }
    }

    if (deposits.length > 0) {
      logger.info(`槽位 ${slot} 共解析出 ${deposits.length} 笔存款`, {
        solCount: deposits.filter(d => d.type === 'sol').length,
        tokenCount: deposits.filter(d => d.type !== 'sol').length
      });
    }

    return deposits;
  }

  /**
   * 解析单个交易
   */
  private async parseTransaction(
    tx: any,
    slot: number,
    blockTime?: number | null,
    status: 'confirmed' | 'finalized' = 'confirmed'
  ): Promise<ParsedDeposit[]> {
    const deposits: ParsedDeposit[] = [];

    if (!tx.meta || tx.meta.err) {
      // 跳过失败的交易
      return deposits;
    }

    // 获取所有交易签名
    const signatures = tx.transaction.signatures || [];

    // 处理每个签名（虽然通常第一个是主签名，但我们记录所有签名）
    for (const txHash of signatures) {
      // 解析 instructions 中的转账（包括 SOL 和 SPL Token）
      const transferDeposits = await this.parseInstructionTransfers(tx, slot, txHash, blockTime, status);
      deposits.push(...transferDeposits);
    }

    return deposits;
  }

  /**
   * 解析 instructions 中的转账（统一处理 SOL 和 SPL Token）
   */
  private async parseInstructionTransfers(
    tx: any,
    slot: number,
    txHash: string,
    blockTime?: number | null,
    status: 'confirmed' | 'finalized' = 'confirmed'
  ): Promise<ParsedDeposit[]> {
    const deposits: ParsedDeposit[] = [];

    try {
      // compiledInstructions
      const instructions = tx.transaction.message.instructions || [];
      const innerInstructions = tx.meta.innerInstructions || [];

      // 解析主指令
      for (const ix of instructions) {
        const deposit = await this.parseInstruction(ix, tx, slot, txHash, blockTime, status);
        if (deposit) deposits.push(deposit);
      }

      // 解析内部指令
      for (const innerIx of innerInstructions) {
        for (const ix of innerIx.instructions || []) {
          const deposit = await this.parseInstruction(ix, tx, slot, txHash, blockTime, status);
          if (deposit) deposits.push(deposit);
        }
      }

      // 对于 Token 转账，使用 ATA 映射匹配钱包地址，并过滤掉不在监控列表中的地址
      const filteredDeposits: ParsedDeposit[] = [];

      for (const deposit of deposits) {
        if (deposit.type !== 'sol') {
          // Token 转账：需要将 ATA 地址映射到钱包地址
          const ataAddress = deposit.toAddr.toLowerCase();
          const walletAddress = this.ataToWalletMap.get(ataAddress);

          if (walletAddress) {
            // 检查钱包地址是否在监控列表中
            if (this.monitoredAddresses.has(walletAddress.toLowerCase())) {
              deposit.toAddr = walletAddress;
              filteredDeposits.push(deposit);
              logger.debug('Token转账匹配成功', {
                ataAddress,
                walletAddress,
                tokenMint: deposit.tokenMint,
                amount: deposit.amount
              });
            } else {
              logger.debug('Token转账钱包不在监控列表', {
                ataAddress,
                walletAddress
              });
            }
          } else {
            logger.debug('Token转账ATA未映射', {
              ataAddress,
              ataMapSize: this.ataToWalletMap.size
            });
          }
        } else {
          // SOL 转账：直接添加（已在 parseSystemProgramInstruction 中过滤）
          filteredDeposits.push(deposit);
        }
      }

      return filteredDeposits;
    } catch (error) {
      logger.error('解析转账失败', { txHash, error });
      return [];
    }
  }

  /**
   * 解析单个指令（统一处理 SOL 和 Token 转账）
   */
  private async parseInstruction(
    ix: any,
    tx: any,
    slot: number,
    txHash: string,
    blockTime?: number | null,
    status: 'confirmed' | 'finalized' = 'confirmed'
  ): Promise<ParsedDeposit | null> {
    try {
      const programId = ix.programId?.toString() || ix.program;

      // 检查是否是 System Program (SOL 转账)
      if (programId === SYSTEM_PROGRAM_ID) {
        return this.parseSystemProgramInstruction(ix, slot, txHash, blockTime, status);
      }

      // 检查是否是 Token 程序 (SPL Token 转账)
      if (programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID) {
        // 解析 parsed 指令
        if (ix.parsed) {
          return this.parseParsedTokenInstruction(ix, programId, tx, slot, txHash, blockTime, status);
        }
      }

      return null;
    } catch (error) {
      logger.error('解析指令失败', { txHash, error });
      return null;
    }
  }

  /**
   * 解析 System Program 指令 (SOL 转账)
   * Program: 11111111111111111111111111111111
   * Type: transfer
   */
  private parseSystemProgramInstruction(
    ix: any,
    slot: number,
    txHash: string,
    blockTime?: number | null,
    status: 'confirmed' | 'finalized' = 'confirmed'
  ): ParsedDeposit | null {
    try {
      if (!ix.parsed) {
        return null;
      }

      const parsed = ix.parsed;

      // 检查是否是 transfer 类型
      if (parsed.type !== 'transfer') {
        return null;
      }

      const info = parsed.info;
      const destination = info.destination;
      const lamports = info.lamports;

      if (!destination || !lamports) {
        return null;
      }

      // 检查目标地址是否是我们监控的地址
      const lowerDest = destination.toLowerCase();
      if (!this.monitoredAddresses.has(lowerDest)) {
        return null;
      }

      return {
        txHash,
        slot,
        fromAddr: info.source || undefined,
        toAddr: destination,
        amount: lamports.toString(),
        type: 'sol',
        blockTime: blockTime || undefined,
        status
      };
    } catch (error) {
      logger.error('解析System Program指令失败', { txHash, error });
      return null;
    }
  }

  /**
   * 从交易的 Token Balances 中提取指定账户的 mint 地址
   *
   * 背景：SPL Token 的 transfer 指令不包含 mint 参数（只有 transferChecked 包含）
   * 原因：
   *   1. 向后兼容性 - transfer 是最早的指令
   *   2. 性能优化 - 不需要额外验证 mint
   *   3. Token Account 本身已包含 mint 信息
   *
   * 解决方案：从交易的 postTokenBalances/preTokenBalances 中提取
   * 这些字段包含了交易中所有 Token Account 的状态，包括 mint 地址
   */
  private extractMintFromTokenBalances(tx: any, accountAddress: string): string | undefined {
    try {
      // 获取交易中所有涉及的账户地址
      const accountKeys = tx.transaction?.message?.accountKeys || [];

      // 找到目标账户的索引
      let accountIndex = -1;
      for (let i = 0; i < accountKeys.length; i++) {
        const key = accountKeys[i];
        const pubkeyStr = typeof key === 'string' ? key : key.pubkey?.toString() || key.toString();
        if (pubkeyStr === accountAddress) {
          accountIndex = i;
          break;
        }
      }

      if (accountIndex === -1) {
        logger.debug('在交易账户列表中未找到目标地址', { accountAddress });
        return undefined;
      }

      // 从 postTokenBalances 中查找该账户的 mint
      const postBalances = tx.meta?.postTokenBalances || [];
      for (const balance of postBalances) {
        if (balance.accountIndex === accountIndex && balance.mint) {
          logger.debug('从 postTokenBalances 提取到 mint', {
            accountAddress,
            mint: balance.mint
          });
          return balance.mint;
        }
      }

      // 如果 postTokenBalances 中没有，尝试 preTokenBalances
      const preBalances = tx.meta?.preTokenBalances || [];
      for (const balance of preBalances) {
        if (balance.accountIndex === accountIndex && balance.mint) {
          logger.debug('从 preTokenBalances 提取到 mint', {
            accountAddress,
            mint: balance.mint
          });
          return balance.mint;
        }
      }

      logger.debug('在 Token Balances 中未找到 mint', { accountAddress });
      return undefined;
    } catch (error) {
      logger.error('从 Token Balances 提取 mint 失败', {
        accountAddress,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  /**
   * 解析已解析的 Token 指令
   * Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA (SPL Token)
   * Program: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb (SPL Token 2022)
   * Type: transfer / transferChecked
   *
   * 注意：destination 是 Token Account (ATA) 地址，不是钱包地址
   */
  private parseParsedTokenInstruction(
    ix: any,
    programId: string,
    tx: any,
    slot: number,
    txHash: string,
    blockTime?: number | null,
    status: 'confirmed' | 'finalized' = 'confirmed'
  ): ParsedDeposit | null {
    try {
      const parsed = ix.parsed;

      // 检查是否是 transfer 或 transferChecked
      if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') {
        return null;
      }

      const info = parsed.info;
      const destination = info.destination; // 这是 Token Account (ATA) 地址
      const amount = info.amount || info.tokenAmount?.amount;

      if (!destination || !amount) {
        return null;
      }

      // 获取 mint 地址
      // transferChecked 指令包含 mint，但 transfer 指令不包含
      // 对于 transfer 指令，需要从 tx.meta.postTokenBalances 中提取
      let mint = info.mint;

      if (!mint) {
        // 尝试从 Token Balances 中提取 mint
        mint = this.extractMintFromTokenBalances(tx, destination);
      }

      const type = programId === TOKEN_2022_PROGRAM_ID ? 'spl-token-2022' : 'spl-token';

      if (!mint) {
        logger.warn('Token转账指令缺少 mint 地址', {
          txHash,
          destination,
          type: parsed.type
        });
      }

      return {
        txHash,
        slot,
        fromAddr: info.source || undefined,
        toAddr: destination, // 这是 Token Account 地址，稍后需要匹配钱包地址
        tokenMint: mint,
        amount: amount,
        type,
        blockTime: blockTime || undefined,
        status
      };
    } catch (error) {
      logger.error('解析Token指令失败', { txHash, error });
      return null;
    }
  }

  /**
   * 处理存款（写入数据库）
   */
  async processDeposit(deposit: ParsedDeposit): Promise<boolean> {
    try {
      // 获取钱包信息
      const wallet = await walletDAO.getWalletByAddress(deposit.toAddr);
      if (!wallet) {
        logger.error('未找到钱包信息', {
          address: deposit.toAddr,
          txHash: deposit.txHash
        });
        return false;
      }

      // 获取代币信息
      let token;
      if (deposit.type === 'sol') {
        token = await tokenDAO.getSolNativeToken();
      } else if (deposit.tokenMint) {
        token = await tokenDAO.getTokenByMintAddress(deposit.tokenMint);
      }

      if (!token) {
        logger.error('未找到代币信息', {
          type: deposit.type,
          mint: deposit.tokenMint,
          txHash: deposit.txHash
        });
        return false;
      }

      // 插入Solana交易记录
      await this.dbGatewayClient.insertSolanaTransaction({
        slot: deposit.slot,
        tx_hash: deposit.txHash,
        from_addr: deposit.fromAddr,
        to_addr: deposit.toAddr,
        token_mint: deposit.tokenMint || undefined,
        amount: deposit.amount,
        type: 'deposit',
        status: deposit.status,
        block_time: deposit.blockTime
      });

      // 创建 credit 记录
      await this.dbGatewayClient.createCredit({
        user_id: wallet.user_id,
        address: deposit.toAddr,
        token_id: token.id,
        token_symbol: token.token_symbol,
        amount: deposit.amount,
        credit_type: 'deposit',
        business_type: 'blockchain',
        reference_type: 'blockchain_tx',
        chain_type: 'solana',
        status: deposit.status,
        block_number: deposit.slot,
        tx_hash: deposit.txHash,
        event_index: 0,
        metadata: {
          token_type: deposit.type,
          block_time: deposit.blockTime
        }
      });

      logger.info('存款处理完成', {
        txHash: deposit.txHash,
        slot: deposit.slot,
        address: deposit.toAddr,
        amount: deposit.amount,
        type: deposit.type,
        tokenSymbol: token.token_symbol
      });

      return true;
    } catch (error: any) {
      if (error?.message?.includes('UNIQUE')) {
        logger.debug('存款记录已存在', { txHash: deposit.txHash });
        return true;
      }
      logger.error('处理存款失败', {
        txHash: deposit.txHash,
        toAddr: deposit.toAddr,
        type: deposit.type,
        tokenMint: deposit.tokenMint,
        error: error.message
      });
      return false;
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      monitoredAddressCount: this.monitoredAddresses.size,
      supportedTokenCount: this.tokenMintMap.size,
      ataCount: this.ataToWalletMap.size,
      lastAddressUpdate: this.lastAddressUpdate,
      lastTokenUpdate: this.lastTokenUpdate,
      lastATAUpdate: this.lastATAUpdate
    };
  }
}

export const transactionParser = new TransactionParser();
