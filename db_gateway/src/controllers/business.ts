import { Request, Response } from 'express';
import { DatabaseService } from '../services/database';
import { RiskControlService } from '../services/riskControl';
import { AuditService } from '../services/audit';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class BusinessController {
  private dbService: DatabaseService;
  private riskControlService: RiskControlService;
  private auditService: AuditService;

  constructor() {
    this.dbService = new DatabaseService();
    this.riskControlService = new RiskControlService();
    this.auditService = new AuditService();
    this.initializeDatabase();
  }

  private async initializeDatabase() {
    try {
      await this.dbService.connect();
      logger.info('Business controller database service initialized');
    } catch (error) {
      logger.error('Failed to initialize business database service', { error });
      throw error;
    }
  }

  // ========== 用户管理 API ==========

  createUser = async (req: Request, res: Response) => {
    try {
      const { username, email, phone, password_hash, user_type } = req.body;

      if (!username) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_USERNAME', message: 'Username is required' }
        });
      }

      const operationId = uuidv4();

      // 执行风控检查
      const riskAssessment = await this.riskControlService.assessRisk({
        operation_id: operationId,
        operation_type: 'write',
        table: 'users',
        action: 'insert',
        data: { username, email, phone, user_type },
        business_signature: 'system',
        timestamp: Date.now(),
        module: 'wallet'
      });

      if (riskAssessment.decision === 'deny') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'OPERATION_DENIED',
            message: 'User creation denied by risk control',
            details: riskAssessment.reasons
          }
        });
      }

      const result = await this.dbService.run(
        `INSERT INTO users (username, email, phone, password_hash, user_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [username, email || null, phone || null, password_hash || null, user_type || 'normal']
      );

      await this.auditService.logOperation({
        operation_id: operationId,
        operation_type: 'write',
        table_name: 'users',
        action: 'insert',
        module: 'system',
        data_before: null,
        data_after: { username, email, phone, user_type },
        business_signer: 'system',
        ip_address: req.ip || 'unknown',
        user_agent: req.get('User-Agent') || 'unknown',
        timestamp: Date.now(),
        result: 'success'
      });

      res.json({
        success: true,
        data: {
          userId: result.lastID,
          username,
          email,
          phone,
          user_type: user_type || 'normal'
        }
      });

    } catch (error) {
      logger.error('Failed to create user', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'USER_CREATION_FAILED',
          message: 'Failed to create user',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  // ========== 钱包管理 API ==========

  createWallet = async (req: Request, res: Response) => {
    try {
      const { user_id, address, device, path, chain_type, wallet_type } = req.body;

      if (!address || !chain_type || !wallet_type) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'address, chain_type, and wallet_type are required' }
        });
      }

      const operationId = uuidv4();

      const result = await this.dbService.run(
        `INSERT INTO wallets (user_id, address, device, path, chain_type, wallet_type, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [user_id || null, address, device || null, path || null, chain_type, wallet_type]
      );

      await this.auditService.logOperation({
        operation_id: operationId,
        operation_type: 'write',
        table_name: 'wallets',
        action: 'insert',
        module: 'system',
        data_before: null,
        data_after: { user_id, address, device, path, chain_type, wallet_type },
        business_signer: 'system',
        ip_address: req.ip || 'unknown',
        user_agent: req.get('User-Agent') || 'unknown',
        timestamp: Date.now(),
        result: 'success'
      });

      res.json({
        success: true,
        data: {
          walletId: result.lastID,
          user_id,
          address,
          chain_type,
          wallet_type
        }
      });

    } catch (error) {
      logger.error('Failed to create wallet', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'WALLET_CREATION_FAILED',
          message: 'Failed to create wallet',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  // ========== 提现管理 API ==========

  createWithdrawRequest = async (req: Request, res: Response) => {
    try {
      const { user_id, to_address, token_id, amount, fee, chain_id, chain_type } = req.body;

      if (!user_id || !to_address || !token_id || !amount || !chain_id || !chain_type) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'All withdraw fields are required' }
        });
      }

      const operationId = uuidv4();

      // 提现是敏感操作，需要风控评估
      const riskAssessment = await this.riskControlService.assessRisk({
        operation_id: operationId,
        operation_type: 'sensitive',
        table: 'withdraws',
        action: 'insert',
        data: { user_id, to_address, token_id, amount, fee, chain_id, chain_type },
        business_signature: 'system',
        timestamp: Date.now(),
        module: 'wallet'
      });

      if (riskAssessment.decision === 'deny') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'WITHDRAW_DENIED',
            message: 'Withdrawal denied by risk control',
            details: riskAssessment.reasons
          }
        });
      }

      if (riskAssessment.decision === 'manual_review') {
        return res.status(202).json({
          success: false,
          error: {
            code: 'MANUAL_APPROVAL_REQUIRED',
            message: 'Withdrawal requires manual approval',
            details: {
              risk_level: riskAssessment.risk_level,
              required_approvals: riskAssessment.required_approvals,
              reasons: riskAssessment.reasons
            }
          }
        });
      }

      const result = await this.dbService.run(
        `INSERT INTO withdraws (user_id, to_address, token_id, amount, fee, chain_id, chain_type, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'user_withdraw_request', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [user_id, to_address, token_id, amount, fee || '0', chain_id, chain_type]
      );

      await this.auditService.logOperation({
        operation_id: operationId,
        operation_type: 'sensitive',
        table_name: 'withdraws',
        action: 'insert',
        module: 'system',
        data_before: null,
        data_after: { user_id, to_address, token_id, amount, fee, chain_id, chain_type },
        business_signer: 'system',
        ip_address: req.ip || 'unknown',
        user_agent: req.get('User-Agent') || 'unknown',
        timestamp: Date.now(),
        result: 'success'
      });

      res.json({
        success: true,
        data: {
          withdrawId: result.lastID,
          user_id,
          to_address,
          token_id,
          amount,
          status: 'user_withdraw_request'
        }
      });

    } catch (error) {
      logger.error('Failed to create withdraw request', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'WITHDRAW_REQUEST_FAILED',
          message: 'Failed to create withdraw request',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  updateWithdrawStatus = async (req: Request, res: Response) => {
    try {
      const { withdraw_id } = req.params;
      const { status, from_address, tx_hash, nonce, gas_used, gas_price, error_message } = req.body;

      if (!withdraw_id || !status) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'withdraw_id and status are required' }
        });
      }

      const operationId = uuidv4();

      // 构建更新字段
      const updateFields = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
      const params = [status];

      if (from_address) {
        updateFields.push('from_address = ?');
        params.push(from_address);
      }
      if (tx_hash) {
        updateFields.push('tx_hash = ?');
        params.push(tx_hash);
      }
      if (nonce !== undefined) {
        updateFields.push('nonce = ?');
        params.push(nonce);
      }
      if (gas_used) {
        updateFields.push('gas_used = ?');
        params.push(gas_used);
      }
      if (gas_price) {
        updateFields.push('gas_price = ?');
        params.push(gas_price);
      }
      if (error_message) {
        updateFields.push('error_message = ?');
        params.push(error_message);
      }

      params.push(withdraw_id);

      const result = await this.dbService.run(
        `UPDATE withdraws SET ${updateFields.join(', ')} WHERE id = ?`,
        params
      );

      await this.auditService.logOperation({
        operation_id: operationId,
        operation_type: 'sensitive',
        table_name: 'withdraws',
        action: 'update',
        module: 'system',
        data_before: null,
        data_after: { withdraw_id, status, from_address, tx_hash, nonce, gas_used, gas_price, error_message },
        business_signer: 'system',
        ip_address: req.ip || 'unknown',
        user_agent: req.get('User-Agent') || 'unknown',
        timestamp: Date.now(),
        result: 'success'
      });

      res.json({
        success: true,
        data: {
          withdraw_id: parseInt(withdraw_id),
          changes: result.changes,
          status
        }
      });

    } catch (error) {
      logger.error('Failed to update withdraw status', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'WITHDRAW_UPDATE_FAILED',
          message: 'Failed to update withdraw status',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  // ========== Credits 管理 API ==========

  createCredit = async (req: Request, res: Response) => {
    try {
      const {
        user_id,
        address,
        token_id,
        token_symbol,
        amount,
        credit_type,
        business_type,
        reference_id,
        reference_type,
        chain_id,
        chain_type,
        status,
        block_number,
        tx_hash,
        event_index,
        metadata
      } = req.body;

      if (!user_id || !token_id || !token_symbol || !amount || !credit_type || !business_type || !reference_id || !reference_type) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'Required credit fields are missing' }
        });
      }

      const operationId = uuidv4();

      // Credits操作是敏感操作
      const riskAssessment = await this.riskControlService.assessRisk({
        operation_id: operationId,
        operation_type: 'sensitive',
        table: 'credits',
        action: 'insert',
        data: { user_id, token_id, amount, credit_type, business_type },
        business_signature: 'system',
        timestamp: Date.now(),
        module: 'wallet'
      });

      if (riskAssessment.decision === 'deny') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'CREDIT_DENIED',
            message: 'Credit operation denied by risk control',
            details: riskAssessment.reasons
          }
        });
      }

      if (riskAssessment.decision === 'manual_review') {
        return res.status(202).json({
          success: false,
          error: {
            code: 'MANUAL_APPROVAL_REQUIRED',
            message: 'Credit operation requires manual approval',
            details: {
              risk_level: riskAssessment.risk_level,
              required_approvals: riskAssessment.required_approvals,
              reasons: riskAssessment.reasons
            }
          }
        });
      }

      const result = await this.dbService.run(
        `INSERT INTO credits (
          user_id, address, token_id, token_symbol, amount, credit_type, business_type,
          reference_id, reference_type, chain_id, chain_type, status, block_number,
          tx_hash, event_index, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          user_id,
          address || '',
          token_id,
          token_symbol,
          amount,
          credit_type,
          business_type,
          reference_id,
          reference_type,
          chain_id || null,
          chain_type || null,
          status || 'pending',
          block_number || null,
          tx_hash || null,
          event_index || 0,
          metadata ? JSON.stringify(metadata) : null
        ]
      );

      await this.auditService.logOperation({
        operation_id: operationId,
        operation_type: 'sensitive',
        table_name: 'credits',
        action: 'insert',
        module: 'system',
        data_before: null,
        data_after: {
          user_id, address, token_id, token_symbol, amount, credit_type,
          business_type, reference_id, reference_type
        },
        business_signer: 'system',
        ip_address: req.ip || 'unknown',
        user_agent: req.get('User-Agent') || 'unknown',
        timestamp: Date.now(),
        result: 'success'
      });

      res.json({
        success: true,
        data: {
          creditId: result.lastID,
          user_id,
          token_id,
          token_symbol,
          amount,
          credit_type,
          status: status || 'pending'
        }
      });

    } catch (error) {
      logger.error('Failed to create credit', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'CREDIT_CREATION_FAILED',
          message: 'Failed to create credit',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  // ========== 区块链数据管理 API ==========

  insertBlock = async (req: Request, res: Response) => {
    try {
      const { hash, parent_hash, number, timestamp, status } = req.body;

      if (!hash || !number) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'hash and number are required' }
        });
      }

      const operationId = uuidv4();

      const result = await this.dbService.run(
        `INSERT INTO blocks (hash, parent_hash, number, timestamp, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [hash, parent_hash || null, number, timestamp || Math.floor(Date.now() / 1000), status || 'confirmed']
      );

      await this.auditService.logOperation({
        operation_id: operationId,
        operation_type: 'write',
        table_name: 'blocks',
        action: 'insert',
        module: 'system',
        data_before: null,
        data_after: { hash, parent_hash, number, timestamp, status },
        business_signer: 'system',
        ip_address: req.ip || 'unknown',
        user_agent: req.get('User-Agent') || 'unknown',
        timestamp: Date.now(),
        result: 'success'
      });

      res.json({
        success: true,
        data: {
          hash,
          number,
          status: status || 'confirmed'
        }
      });

    } catch (error) {
      logger.error('Failed to insert block', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'BLOCK_INSERT_FAILED',
          message: 'Failed to insert block',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  insertTransaction = async (req: Request, res: Response) => {
    try {
      const {
        block_hash,
        block_no,
        tx_hash,
        from_addr,
        to_addr,
        token_addr,
        amount,
        type,
        status,
        confirmation_count
      } = req.body;

      if (!tx_hash) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_TX_HASH', message: 'tx_hash is required' }
        });
      }

      const operationId = uuidv4();

      const result = await this.dbService.run(
        `INSERT INTO transactions (
          block_hash, block_no, tx_hash, from_addr, to_addr, token_addr,
          amount, type, status, confirmation_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          block_hash || null,
          block_no || null,
          tx_hash,
          from_addr || null,
          to_addr || null,
          token_addr || null,
          amount || null,
          type || null,
          status || 'confirmed',
          confirmation_count || 0
        ]
      );

      await this.auditService.logOperation({
        operation_id: operationId,
        operation_type: 'write',
        table_name: 'transactions',
        action: 'insert',
        module: 'system',
        data_before: null,
        data_after: { block_hash, block_no, tx_hash, from_addr, to_addr, token_addr, amount, type, status },
        business_signer: 'system',
        ip_address: req.ip || 'unknown',
        user_agent: req.get('User-Agent') || 'unknown',
        timestamp: Date.now(),
        result: 'success'
      });

      res.json({
        success: true,
        data: {
          transactionId: result.lastID,
          tx_hash,
          status: status || 'confirmed'
        }
      });

    } catch (error) {
      logger.error('Failed to insert transaction', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'TRANSACTION_INSERT_FAILED',
          message: 'Failed to insert transaction',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  // ========== 读取数据 API ==========

  getUser = async (req: Request, res: Response) => {
    try {
      const { user_id, username } = req.query;

      if (!user_id && !username) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_IDENTIFIER', message: 'user_id or username is required' }
        });
      }

      let sql = 'SELECT * FROM users WHERE ';
      let params: any[] = [];

      if (user_id) {
        sql += 'id = ?';
        params.push(user_id);
      } else {
        sql += 'username = ?';
        params.push(username);
      }

      const users = await this.dbService.query(sql, params);

      res.json({
        success: true,
        data: users.length > 0 ? users[0] : null
      });

    } catch (error) {
      logger.error('Failed to get user', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'USER_RETRIEVAL_FAILED',
          message: 'Failed to retrieve user',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  getUserBalance = async (req: Request, res: Response) => {
    try {
      const { user_id, token_id } = req.query;

      if (!user_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_USER_ID', message: 'user_id is required' }
        });
      }

      let sql = `
        SELECT
          token_id,
          token_symbol,
          SUM(CASE WHEN credit_type = 'credit' THEN CAST(amount AS REAL) ELSE -CAST(amount AS REAL) END) as balance
        FROM credits
        WHERE user_id = ? AND status = 'confirmed'
      `;
      let params: any[] = [user_id];

      if (token_id) {
        sql += ' AND token_id = ?';
        params.push(token_id);
      }

      sql += ' GROUP BY token_id, token_symbol';

      const balances = await this.dbService.query(sql, params);

      res.json({
        success: true,
        data: balances
      });

    } catch (error) {
      logger.error('Failed to get user balance', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'BALANCE_RETRIEVAL_FAILED',
          message: 'Failed to retrieve user balance',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  getWallets = async (req: Request, res: Response) => {
    try {
      const { user_id, chain_type, wallet_type, is_active } = req.query;

      let sql = 'SELECT * FROM wallets WHERE 1=1';
      const params: any[] = [];

      if (user_id) {
        sql += ' AND user_id = ?';
        params.push(user_id);
      }
      if (chain_type) {
        sql += ' AND chain_type = ?';
        params.push(chain_type);
      }
      if (wallet_type) {
        sql += ' AND wallet_type = ?';
        params.push(wallet_type);
      }
      if (is_active !== undefined) {
        sql += ' AND is_active = ?';
        params.push(is_active === 'true' ? 1 : 0);
      }

      sql += ' ORDER BY created_at DESC';

      const wallets = await this.dbService.query(sql, params);

      res.json({
        success: true,
        data: wallets
      });

    } catch (error) {
      logger.error('Failed to get wallets', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'WALLETS_RETRIEVAL_FAILED',
          message: 'Failed to retrieve wallets',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  getWithdraws = async (req: Request, res: Response) => {
    try {
      const { user_id, status, limit } = req.query;

      let sql = 'SELECT * FROM withdraws WHERE 1=1';
      const params: any[] = [];

      if (user_id) {
        sql += ' AND user_id = ?';
        params.push(user_id);
      }
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }

      sql += ' ORDER BY created_at DESC';

      if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit as string));
      }

      const withdraws = await this.dbService.query(sql, params);

      res.json({
        success: true,
        data: withdraws
      });

    } catch (error) {
      logger.error('Failed to get withdraws', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'WITHDRAWS_RETRIEVAL_FAILED',
          message: 'Failed to retrieve withdraws',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  getTransactions = async (req: Request, res: Response) => {
    try {
      const { block_hash, block_no, tx_hash, from_addr, to_addr, status, limit } = req.query;

      let sql = 'SELECT * FROM transactions WHERE 1=1';
      const params: any[] = [];

      if (block_hash) {
        sql += ' AND block_hash = ?';
        params.push(block_hash);
      }
      if (block_no) {
        sql += ' AND block_no = ?';
        params.push(block_no);
      }
      if (tx_hash) {
        sql += ' AND tx_hash = ?';
        params.push(tx_hash);
      }
      if (from_addr) {
        sql += ' AND from_addr = ?';
        params.push(from_addr);
      }
      if (to_addr) {
        sql += ' AND to_addr = ?';
        params.push(to_addr);
      }
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }

      sql += ' ORDER BY created_at DESC';

      if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit as string));
      }

      const transactions = await this.dbService.query(sql, params);

      res.json({
        success: true,
        data: transactions
      });

    } catch (error) {
      logger.error('Failed to get transactions', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'TRANSACTIONS_RETRIEVAL_FAILED',
          message: 'Failed to retrieve transactions',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  getBlocks = async (req: Request, res: Response) => {
    try {
      const { hash, number, status, limit } = req.query;

      let sql = 'SELECT * FROM blocks WHERE 1=1';
      const params: any[] = [];

      if (hash) {
        sql += ' AND hash = ?';
        params.push(hash);
      }
      if (number) {
        sql += ' AND number = ?';
        params.push(number);
      }
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }

      sql += ' ORDER BY number DESC';

      if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit as string));
      }

      const blocks = await this.dbService.query(sql, params);

      res.json({
        success: true,
        data: blocks
      });

    } catch (error) {
      logger.error('Failed to get blocks', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'BLOCKS_RETRIEVAL_FAILED',
          message: 'Failed to retrieve blocks',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  async close() {
    await this.dbService.close();
    await this.auditService.close();
  }
}