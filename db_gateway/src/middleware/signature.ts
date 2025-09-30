import { Request, Response, NextFunction } from 'express';
import { Ed25519Verifier } from '../utils/crypto';
import { GatewayRequest, SignaturePayload, BatchGatewayRequest } from '../types';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  gatewayRequest?: GatewayRequest;
  batchGatewayRequest?: BatchGatewayRequest;
  signaturePayload?: SignaturePayload;
}

export class SignatureMiddleware {
  private verifier: Ed25519Verifier;

  constructor() {
    this.verifier = new Ed25519Verifier();
  }

  validateRequest = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const gatewayRequest = req.body as GatewayRequest;

      // 验证必要字段
      if (!gatewayRequest.operation_id ||
          !gatewayRequest.operation_type ||
          !gatewayRequest.table ||
          !gatewayRequest.action ||
          !gatewayRequest.business_signature ||
          !gatewayRequest.timestamp ||
          !gatewayRequest.module) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing required fields',
            details: 'operation_id, operation_type, table, action, business_signature, timestamp, and module are required'
          }
        });
      }

      // 验证模块类型
      if (!['wallet', 'scan'].includes(gatewayRequest.module)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_MODULE',
            message: 'Invalid module specified',
            details: 'Module must be either wallet or scan'
          }
        });
      }

      // 验证时间戳（5分钟窗口）
      const now = Date.now();
      const requestTime = gatewayRequest.timestamp;
      const timeDiff = Math.abs(now - requestTime);
      const maxTimeDiff = 5 * 60 * 1000; // 5 minutes

      if (timeDiff > maxTimeDiff) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'TIMESTAMP_EXPIRED',
            message: 'Request timestamp is too old or too far in the future',
            details: `Time difference: ${timeDiff}ms, max allowed: ${maxTimeDiff}ms`
          }
        });
      }

      // 检查模块是否有配置的公钥
      if (!this.verifier.hasPublicKey(gatewayRequest.module)) {
        return res.status(500).json({
          success: false,
          error: {
            code: 'NO_PUBLIC_KEY',
            message: 'No public key configured for this module',
            details: `Module ${gatewayRequest.module} does not have a configured public key`
          }
        });
      }

      req.gatewayRequest = gatewayRequest;
      next();
    } catch (error) {
      logger.error('Request validation failed', { error, body: req.body });
      return res.status(400).json({
        success: false,
        error: {
          code: 'REQUEST_VALIDATION_ERROR',
          message: 'Failed to validate request',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  verifyBusinessSignature = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const gatewayRequest = req.gatewayRequest!;

      // 创建签名负载
      const signaturePayload: SignaturePayload = {
        operation_id: gatewayRequest.operation_id,
        operation_type: gatewayRequest.operation_type,
        table: gatewayRequest.table,
        action: gatewayRequest.action,
        data: gatewayRequest.data,
        conditions: gatewayRequest.conditions,
        timestamp: gatewayRequest.timestamp,
        module: gatewayRequest.module
      };

      // 验证业务签名
      const isValidSignature = this.verifier.verifySignature(
        signaturePayload,
        gatewayRequest.business_signature,
        gatewayRequest.module
      );

      if (!isValidSignature) {
        logger.warn('Business signature verification failed', {
          operation_id: gatewayRequest.operation_id,
          module: gatewayRequest.module,
          table: gatewayRequest.table,
          action: gatewayRequest.action
        });

        return res.status(401).json({
          success: false,
          error: {
            code: 'SIGNATURE_VERIFICATION_FAILED',
            message: 'Business signature verification failed',
            details: 'The provided signature is invalid'
          }
        });
      }

      req.signaturePayload = signaturePayload;
      logger.info('Business signature verified successfully', {
        operation_id: gatewayRequest.operation_id,
        module: gatewayRequest.module
      });

      next();
    } catch (error) {
      logger.error('Signature verification error', { error, operation_id: req.gatewayRequest?.operation_id });
      return res.status(500).json({
        success: false,
        error: {
          code: 'SIGNATURE_VERIFICATION_ERROR',
          message: 'Failed to verify signature',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  checkRiskControlSignature = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const gatewayRequest = req.gatewayRequest!;

      // 检查是否需要风控签名（敏感操作）
      if (gatewayRequest.operation_type === 'sensitive') {
        // TODO: 实现风控签名验证
        // 现在只是预留接口，暂时跳过验证
        logger.info('Sensitive operation detected, risk control verification needed', {
          operation_id: gatewayRequest.operation_id,
          table: gatewayRequest.table,
          action: gatewayRequest.action
        });

        // 预留风控签名验证逻辑
        if (gatewayRequest.risk_control_signature) {
          logger.info('Risk control signature provided (validation skipped for now)', {
            operation_id: gatewayRequest.operation_id
          });
        } else {
          logger.warn('Sensitive operation without risk control signature', {
            operation_id: gatewayRequest.operation_id
          });

          // 暂时允许通过，但记录警告
          // 在生产环境中，这里应该返回错误
        }
      }

      next();
    } catch (error) {
      logger.error('Risk control verification error', { error, operation_id: req.gatewayRequest?.operation_id });
      return res.status(500).json({
        success: false,
        error: {
          code: 'RISK_CONTROL_VERIFICATION_ERROR',
          message: 'Failed to verify risk control signature',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  validateBatchRequest = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const batchRequest = req.body as BatchGatewayRequest;

      // 验证必要字段
      if (!batchRequest.operation_id ||
          !batchRequest.operation_type ||
          !batchRequest.operations ||
          !Array.isArray(batchRequest.operations) ||
          batchRequest.operations.length === 0 ||
          !batchRequest.business_signature ||
          !batchRequest.timestamp ||
          !batchRequest.module) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_BATCH_REQUEST',
            message: 'Missing required fields for batch operation',
            details: 'operation_id, operation_type, operations (array), business_signature, timestamp, and module are required'
          }
        });
      }

      // 验证每个操作的必要字段
      for (let i = 0; i < batchRequest.operations.length; i++) {
        const op = batchRequest.operations[i];
        if (!op.table || !op.action) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_OPERATION',
              message: `Invalid operation at index ${i}`,
              details: 'Each operation must have table and action fields'
            }
          });
        }
      }

      // 验证模块类型
      if (!['wallet', 'scan'].includes(batchRequest.module)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_MODULE',
            message: 'Invalid module specified',
            details: 'Module must be either wallet or scan'
          }
        });
      }

      // 验证时间戳（5分钟窗口）
      const now = Date.now();
      const requestTime = batchRequest.timestamp;
      const timeDiff = Math.abs(now - requestTime);
      const maxTimeDiff = 5 * 60 * 1000; // 5 minutes

      if (timeDiff > maxTimeDiff) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'TIMESTAMP_EXPIRED',
            message: 'Request timestamp is too old or too far in the future',
            details: `Time difference: ${timeDiff}ms, max allowed: ${maxTimeDiff}ms`
          }
        });
      }

      // 检查模块是否有配置的公钥
      if (!this.verifier.hasPublicKey(batchRequest.module)) {
        return res.status(500).json({
          success: false,
          error: {
            code: 'NO_PUBLIC_KEY',
            message: 'No public key configured for this module',
            details: `Module ${batchRequest.module} does not have a configured public key`
          }
        });
      }

      req.batchGatewayRequest = batchRequest;
      next();
    } catch (error) {
      logger.error('Batch request validation failed', { error, body: req.body });
      return res.status(400).json({
        success: false,
        error: {
          code: 'BATCH_REQUEST_VALIDATION_ERROR',
          message: 'Failed to validate batch request',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };

  verifyBatchBusinessSignature = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const batchRequest = req.batchGatewayRequest!;

      // 创建签名负载（包含所有操作）
      const signaturePayload: any = {
        operation_id: batchRequest.operation_id,
        operation_type: batchRequest.operation_type,
        operations: batchRequest.operations,
        timestamp: batchRequest.timestamp,
        module: batchRequest.module
      };

      const messageString = JSON.stringify(signaturePayload);
      const messageBytes = new TextEncoder().encode(messageString);

      // 验证业务签名
      const isValidSignature = this.verifier.verifySignature(
        signaturePayload as any,
        batchRequest.business_signature,
        batchRequest.module
      );

      if (!isValidSignature) {
        logger.warn('Batch business signature verification failed', {
          operation_id: batchRequest.operation_id,
          module: batchRequest.module,
          operation_count: batchRequest.operations.length
        });

        return res.status(401).json({
          success: false,
          error: {
            code: 'BATCH_SIGNATURE_VERIFICATION_FAILED',
            message: 'Batch business signature verification failed',
            details: 'The provided signature is invalid'
          }
        });
      }

      logger.info('Batch business signature verified successfully', {
        operation_id: batchRequest.operation_id,
        module: batchRequest.module,
        operation_count: batchRequest.operations.length
      });

      next();
    } catch (error) {
      logger.error('Batch signature verification error', { error, operation_id: req.batchGatewayRequest?.operation_id });
      return res.status(500).json({
        success: false,
        error: {
          code: 'BATCH_SIGNATURE_VERIFICATION_ERROR',
          message: 'Failed to verify batch signature',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  };
}