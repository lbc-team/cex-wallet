import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { RiskAssessmentService } from './services/risk-assessment';
import { RiskController } from './controllers/risk';
import { logger } from './utils/logger';
import { Ed25519Signer } from './utils/crypto';

// 加载环境变量
dotenv.config();

class RiskControlService {
  private app: express.Application;
  private port: number;
  private riskService: RiskAssessmentService;
  private riskController: RiskController;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3004');

    // 初始化风控服务
    const privateKey = process.env.RISK_PRIVATE_KEY;
    if (!privateKey) {
      logger.error('RISK_PRIVATE_KEY is not set in environment variables');
      logger.info('Generating a new keypair for development...');
      const keyPair = Ed25519Signer.generateKeyPair();
      logger.warn('Generated keypair (SAVE THESE FOR PRODUCTION!):', {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey
      });
      this.riskService = new RiskAssessmentService(keyPair.privateKey);
    } else {
      this.riskService = new RiskAssessmentService(privateKey);
    }

    this.riskController = new RiskController(this.riskService);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware() {
    // 安全中间件
    this.app.use(helmet());

    // CORS配置 - 允许 scan 和 wallet 服务访问
    this.app.use(cors({
      origin: [
        'http://localhost:3001',  // wallet service
        'http://localhost:3002',  // scan service
        'http://localhost:3003'   // db_gateway service
      ],
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    }));

    // JSON解析
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // 请求日志
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
        service: 'Risk Control Service',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // 风控评估端点
    this.app.post('/api/assess', this.riskController.assessRisk);

    // 提现风险评估端点
    this.app.post('/api/withdraw-risk-assessment', this.riskController.withdrawRiskAssessment);

    // 人工审核相关端点
    this.app.post('/api/manual-review', this.riskController.submitManualReview);
    this.app.get('/api/pending-reviews', this.riskController.getPendingReviews);
    this.app.get('/api/review-history/:operation_id', this.riskController.getReviewHistory);

    // 查询风控评估结果
    this.app.get('/api/assessment/:operation_id', this.riskController.getAssessmentByOperationId);

    // 密钥生成端点（仅开发环境）
    if (process.env.NODE_ENV === 'development') {
      this.app.post('/api/generate-keypair', (req, res) => {
        const keyPair = Ed25519Signer.generateKeyPair();
        logger.warn('Generated new keypair', {
          publicKey: keyPair.publicKey
        });
        res.json({
          success: true,
          publicKey: keyPair.publicKey,
          privateKey: keyPair.privateKey,
          warning: 'NEVER expose private key in production!'
        });
      });
    }

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
      logger.info('Risk Control Service shut down gracefully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', { error });
      process.exit(1);
    }
  }

  public async start() {
    // 连接数据库
    const { riskControlDB } = await import('./db/connection');
    await riskControlDB.connect();
    logger.info('Database connected successfully');

    this.app.listen(this.port, '0.0.0.0', () => {
      logger.info('Risk Control Service started', {
        port: this.port,
        nodeEnv: process.env.NODE_ENV || 'development',
        pid: process.pid
      });

      logger.info('Risk Control Public Key', {
        publicKey: this.riskService.getPublicKey(),
        note: 'Configure this in db_gateway as RISK_PUBLIC_KEY'
      });
    });
  }
}

// 启动服务
async function main() {
  try {
    const service = new RiskControlService();
    await service.start();
  } catch (error) {
    logger.error('Failed to start Risk Control Service', { error });
    process.exit(1);
  }
}

main();
