import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { GatewayController } from './controllers/gateway';
import { SignatureMiddleware } from './middleware/signature';
import { logger } from './utils/logger';
import { Ed25519Verifier } from './utils/crypto';

// 加载环境变量
dotenv.config();

class DatabaseGatewayService {
  private app: express.Application;
  private port: number;
  private gatewayController: GatewayController;
  private signatureMiddleware: SignatureMiddleware;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3003');
    this.gatewayController = new GatewayController();
    this.signatureMiddleware = new SignatureMiddleware();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware() {
    // 安全中间件
    this.app.use(helmet());

    // CORS配置
    this.app.use(cors({
      origin: ['http://localhost:3001', 'http://localhost:3002'], // wallet和scan服务
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    }));

    // 请求限制
    const rateLimiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000'),
      message: {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later'
        }
      },
      standardHeaders: true,
      legacyHeaders: false
    });

    this.app.use(rateLimiter);

    // JSON解析
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // 请求日志记录
    this.app.use((req, res, next) => {
      logger.info('Incoming request', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  private setupRoutes() {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({
        success: true,
        service: 'Database Gateway Service',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // 密钥管理端点（仅用于开发和部署时生成密钥）
    if (process.env.NODE_ENV === 'development') {
      this.app.post('/generate-keypair', (req, res) => {
        const verifier = new Ed25519Verifier();
        const keyPair = verifier.generateKeyPair();

        logger.warn('Generated new key pair', {
          publicKey: keyPair.publicKey,
          // 注意：在生产环境中绝不要记录私钥
          note: 'Private key should be stored securely and never logged'
        });

        res.json({
          success: true,
          publicKey: keyPair.publicKey,
          privateKey: keyPair.privateKey,
          note: 'Store the private key securely. The public key should be configured in the environment variables.'
        });
      });
    }

    // 数据库操作API
    this.app.post('/api/database/execute',
      this.signatureMiddleware.validateRequest,
      this.signatureMiddleware.verifyBusinessSignature,
      this.signatureMiddleware.checkRiskControlSignature,
      this.gatewayController.executeOperation
    );

    // 批量数据库操作API（支持事务）
    this.app.post('/api/database/batch',
      this.signatureMiddleware.validateBatchRequest,
      this.signatureMiddleware.verifyBatchBusinessSignature,
      this.gatewayController.executeBatchOperation
    );

    // 风控评估API
    this.app.post('/api/risk-control/evaluate', async (req, res) => {
      try {
        const gatewayRequest = req.body;

        if (!gatewayRequest || !gatewayRequest.operation_id) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'Invalid risk evaluation request'
            }
          });
        }

        const riskAssessment = await this.gatewayController.riskControlService.assessRisk(gatewayRequest);

        res.json({
          success: true,
          data: riskAssessment
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: 'RISK_EVALUATION_FAILED',
            message: 'Risk evaluation failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
    });

    // 风控人工审批API
    this.app.post('/api/risk-control/approve', async (req, res) => {
      try {
        const { operation_id, approver_user_id, approved, comment } = req.body;

        if (!operation_id || !approver_user_id || typeof approved !== 'boolean') {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'Missing required fields: operation_id, approver_user_id, approved'
            }
          });
        }

        const result = await this.gatewayController.riskControlService.manualApprove(
          operation_id,
          approver_user_id,
          approved,
          comment
        );

        if (result.success) {
          res.json({
            success: true,
            message: result.message
          });
        } else {
          res.status(400).json({
            success: false,
            error: {
              code: 'APPROVAL_FAILED',
              message: result.message
            }
          });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: 'APPROVAL_PROCESSING_FAILED',
            message: 'Failed to process manual approval',
            details: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
    });

    // 获取待审批操作列表API
    this.app.get('/api/risk-control/pending', async (req, res) => {
      try {
        const pendingApprovals = await this.gatewayController.riskControlService.getPendingApprovals();

        res.json({
          success: true,
          data: pendingApprovals,
          count: pendingApprovals.length
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: 'PENDING_RETRIEVAL_FAILED',
            message: 'Failed to retrieve pending approvals',
            details: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
    });

    // 风控规则管理API
    this.app.get('/api/risk-control/rules', (req, res) => {
      try {
        const rules = this.gatewayController.riskControlService.getRiskRules();
        res.json({
          success: true,
          data: rules,
          count: rules.length
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: 'RULES_RETRIEVAL_FAILED',
            message: 'Failed to retrieve risk control rules'
          }
        });
      }
    });

    // 404 处理
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'API endpoint not found',
          details: `${req.method} ${req.originalUrl} is not a valid endpoint`
        }
      });
    });
  }

  private setupErrorHandling() {
    // 全局错误处理
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method
      });

      if (res.headersSent) {
        return next(error);
      }

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    });

    // 未处理的Promise拒绝
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection', { reason, promise });
    });

    // 未捕获的异常
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', { error });
      process.exit(1);
    });

    // 优雅关闭
    process.on('SIGTERM', this.gracefulShutdown.bind(this));
    process.on('SIGINT', this.gracefulShutdown.bind(this));
  }

  private async gracefulShutdown(signal: string) {
    logger.info(`Received ${signal}, starting graceful shutdown`);

    try {
      await this.gatewayController.close();
      logger.info('Database connections closed');

      logger.close();

      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', { error });
      process.exit(1);
    }
  }

  public start() {
    this.app.listen(this.port, '0.0.0.0', () => {
      logger.info('Database Gateway Service started', {
        port: this.port,
        nodeEnv: process.env.NODE_ENV || 'development',
        pid: process.pid
      });

      // 验证配置
      const verifier = new Ed25519Verifier();
      const hasWalletKey = verifier.hasPublicKey('wallet');
      const hasScanKey = verifier.hasPublicKey('scan');

      logger.info('Public key configuration', {
        wallet: hasWalletKey ? 'configured' : 'missing',
        scan: hasScanKey ? 'configured' : 'missing'
      });

      if (!hasWalletKey || !hasScanKey) {
        logger.warn('Some public keys are missing. Service will reject requests from modules without configured keys.');
      }
    });
  }
}

// 启动服务
const service = new DatabaseGatewayService();
service.start();