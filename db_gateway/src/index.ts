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
  private dbService: import('./services/database').DatabaseService;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3003');

    // 创建共享的DatabaseService实例
    const { DatabaseService } = require('./services/database');
    this.dbService = new DatabaseService();

    this.gatewayController = new GatewayController();
    this.signatureMiddleware = new SignatureMiddleware(this.dbService);

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
      this.signatureMiddleware.verifyRiskControlSignature,
      this.gatewayController.executeOperation
    );

    // 批量数据库操作API（支持事务）
    this.app.post('/api/database/batch',
      this.signatureMiddleware.validateBatchRequest,
      this.signatureMiddleware.verifyBatchBusinessSignature,
      this.signatureMiddleware.verifyBatchRiskControlSignature,
      this.gatewayController.executeBatchOperation
    );


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

  public async start() {
    // 先连接数据库
    try {
      await this.dbService.connect();
    } catch (error) {
      logger.error('Failed to connect to database', { error });
      process.exit(1);
    }

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
      const hasRiskKey = verifier.hasPublicKey('risk');

      logger.info('Public key configuration', {
        wallet: hasWalletKey ? 'configured' : 'missing',
        scan: hasScanKey ? 'configured' : 'missing',
        risk: hasRiskKey ? 'configured' : 'missing'
      });

      if (!hasWalletKey || !hasScanKey) {
        logger.warn('Some public keys are missing. Service will reject requests from modules without configured keys.');
      }

      if (!hasRiskKey) {
        logger.warn('Risk control public key is missing. Sensitive operations will be rejected.');
      }
    });
  }
}

// 启动服务
const service = new DatabaseGatewayService();
service.start();