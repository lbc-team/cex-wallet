import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../services/database';
import { RiskControlService, RiskAssessment } from '../services/riskControl';
import { AuthenticatedRequest } from '../middleware/signature';
import { GatewayResponse, OperationType, DatabaseAction, BatchGatewayResponse } from '../types';
import { logger } from '../utils/logger';

export class GatewayController {
  private dbService: DatabaseService;
  public riskControlService: RiskControlService;

  constructor() {
    this.dbService = new DatabaseService();
    this.riskControlService = new RiskControlService();
    this.initializeDatabase();
  }

  private async initializeDatabase() {
    try {
      await this.dbService.connect();
      logger.info('Gateway database service initialized');
    } catch (error) {
      logger.error('Failed to initialize database service', { error });
      throw error;
    }
  }

  executeOperation = async (req: AuthenticatedRequest, res: Response) => {
    const gatewayRequest = req.gatewayRequest!;

    logger.info('Executing database operation', {
      operation_id: gatewayRequest.operation_id,
      module: gatewayRequest.module,
      table: gatewayRequest.table,
      action: gatewayRequest.action,
      operation_type: gatewayRequest.operation_type
    });

    try {
      // 敏感操作需要风控评估
      if (gatewayRequest.operation_type === 'sensitive') {
        const riskAssessment = await this.riskControlService.assessRisk(gatewayRequest);

        logger.info('Risk assessment completed', {
          operation_id: gatewayRequest.operation_id,
          risk_level: riskAssessment.risk_level,
          decision: riskAssessment.decision,
          risk_score: riskAssessment.risk_score
        });

        // 如果风控决策是拒绝，直接返回错误
        if (riskAssessment.decision === 'deny') {
          const response: GatewayResponse = {
            success: false,
            operation_id: gatewayRequest.operation_id,
            error: {
              code: 'RISK_CONTROL_DENIED',
              message: 'Operation denied by risk control policy',
              details: {
                risk_level: riskAssessment.risk_level,
                risk_score: riskAssessment.risk_score,
                reasons: riskAssessment.reasons
              }
            }
          };

          res.status(403).json(response);
          return;
        }

        // 如果需要人工审核，返回待审批状态
        if (riskAssessment.decision === 'manual_review') {
          const response: GatewayResponse = {
            success: false,
            operation_id: gatewayRequest.operation_id,
            error: {
              code: 'MANUAL_APPROVAL_REQUIRED',
              message: 'Operation requires manual risk control approval',
              details: {
                risk_level: riskAssessment.risk_level,
                risk_score: riskAssessment.risk_score,
                required_approvals: riskAssessment.required_approvals,
                reasons: riskAssessment.reasons,
                expires_at: riskAssessment.expires_at
              }
            }
          };

          res.status(202).json(response); // 202 Accepted, but needs approval
          return;
        }

        // 风控通过，继续执行操作
        logger.info('Risk control approved, proceeding with operation', {
          operation_id: gatewayRequest.operation_id
        });
      }

      let result: any;

      // 执行数据库操作
      switch (gatewayRequest.action) {
        case DatabaseAction.SELECT:
          result = await this.handleSelectOperation(gatewayRequest);
          break;
        case DatabaseAction.INSERT:
          result = await this.handleInsertOperation(gatewayRequest);
          break;
        case DatabaseAction.UPDATE:
          result = await this.handleUpdateOperation(gatewayRequest);
          break;
        case DatabaseAction.DELETE:
          result = await this.handleDeleteOperation(gatewayRequest);
          break;
        default:
          throw new Error(`Unsupported database action: ${gatewayRequest.action}`);
      }

      const response: GatewayResponse = {
        success: true,
        operation_id: gatewayRequest.operation_id,
        data: result
      };

      logger.info('Database operation completed successfully', {
        operation_id: gatewayRequest.operation_id
      });

      res.json(response);

    } catch (error) {
      logger.error('Database operation failed', {
        operation_id: gatewayRequest.operation_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      const response: GatewayResponse = {
        success: false,
        operation_id: gatewayRequest.operation_id,
        error: {
          code: 'DATABASE_OPERATION_FAILED',
          message: 'Database operation failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      };

      res.status(500).json(response);
    }
  };

  private async handleSelectOperation(gatewayRequest: any) {
    let sql = `SELECT * FROM ${gatewayRequest.table}`;
    const params: any[] = [];

    if (gatewayRequest.conditions) {
      const whereClause = this.buildWhereClause(gatewayRequest.conditions, params);
      sql += ` WHERE ${whereClause}`;
    }

    return await this.dbService.query(sql, params);
  }

  private async handleInsertOperation(gatewayRequest: any) {
    if (!gatewayRequest.data) {
      throw new Error('Insert operation requires data');
    }

    const columns = Object.keys(gatewayRequest.data);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(col => gatewayRequest.data[col]);

    const sql = `INSERT INTO ${gatewayRequest.table} (${columns.join(', ')}) VALUES (${placeholders})`;

    const result = await this.dbService.run(sql, values);
    return {
      lastID: result.lastID,
      changes: result.changes
    };
  }

  private async handleUpdateOperation(gatewayRequest: any) {
    if (!gatewayRequest.data) {
      throw new Error('Update operation requires data');
    }

    if (!gatewayRequest.conditions) {
      throw new Error('Update operation requires conditions');
    }

    const setColumns = Object.keys(gatewayRequest.data);
    const setClause = setColumns.map(col => `${col} = ?`).join(', ');
    const setValues = setColumns.map(col => gatewayRequest.data[col]);

    const whereParams: any[] = [];
    const whereClause = this.buildWhereClause(gatewayRequest.conditions, whereParams);

    const sql = `UPDATE ${gatewayRequest.table} SET ${setClause} WHERE ${whereClause}`;
    const params = [...setValues, ...whereParams];

    const result = await this.dbService.run(sql, params);
    return {
      changes: result.changes
    };
  }

  private async handleDeleteOperation(gatewayRequest: any) {
    if (!gatewayRequest.conditions) {
      throw new Error('Delete operation requires conditions');
    }

    const params: any[] = [];
    const whereClause = this.buildWhereClause(gatewayRequest.conditions, params);

    const sql = `DELETE FROM ${gatewayRequest.table} WHERE ${whereClause}`;

    const result = await this.dbService.run(sql, params);
    return {
      changes: result.changes
    };
  }

  private buildWhereClause(conditions: any, params: any[]): string {
    const clauses: string[] = [];

    for (const [column, value] of Object.entries(conditions)) {
      if (value === null) {
        clauses.push(`${column} IS NULL`);
      } else if (Array.isArray(value)) {
        const placeholders = value.map(() => '?').join(', ');
        clauses.push(`${column} IN (${placeholders})`);
        params.push(...value);
      } else if (typeof value === 'object' && value !== null) {
        // 支持操作符，如 { '>': 100 }
        for (const [operator, operatorValue] of Object.entries(value)) {
          clauses.push(`${column} ${operator} ?`);
          params.push(operatorValue);
        }
      } else {
        clauses.push(`${column} = ?`);
        params.push(value);
      }
    }

    return clauses.join(' AND ');
  }

  executeBatchOperation = async (req: AuthenticatedRequest, res: Response) => {
    const batchRequest = req.batchGatewayRequest!;

    logger.info('Executing batch database operation', {
      operation_id: batchRequest.operation_id,
      module: batchRequest.module,
      operation_type: batchRequest.operation_type,
      operation_count: batchRequest.operations.length
    });

    try {
      // 敏感操作需要风控评估
      if (batchRequest.operation_type === 'sensitive') {
        // 对整个批量操作进行风控评估
        const riskAssessment = await this.riskControlService.assessRisk({
          operation_id: batchRequest.operation_id,
          operation_type: batchRequest.operation_type,
          table: 'batch',
          action: 'batch',
          data: { operations: batchRequest.operations },
          business_signature: batchRequest.business_signature,
          timestamp: batchRequest.timestamp,
          module: batchRequest.module
        } as any);

        logger.info('Risk assessment completed for batch operation', {
          operation_id: batchRequest.operation_id,
          risk_level: riskAssessment.risk_level,
          decision: riskAssessment.decision,
          risk_score: riskAssessment.risk_score
        });

        if (riskAssessment.decision === 'deny') {
          const response: BatchGatewayResponse = {
            success: false,
            operation_id: batchRequest.operation_id,
            error: {
              code: 'RISK_CONTROL_DENIED',
              message: 'Batch operation denied by risk control policy',
              details: {
                risk_level: riskAssessment.risk_level,
                risk_score: riskAssessment.risk_score,
                reasons: riskAssessment.reasons
              }
            }
          };

          res.status(403).json(response);
          return;
        }

        if (riskAssessment.decision === 'manual_review') {
          const response: BatchGatewayResponse = {
            success: false,
            operation_id: batchRequest.operation_id,
            error: {
              code: 'MANUAL_APPROVAL_REQUIRED',
              message: 'Batch operation requires manual risk control approval',
              details: {
                risk_level: riskAssessment.risk_level,
                risk_score: riskAssessment.risk_score,
                required_approvals: riskAssessment.required_approvals,
                reasons: riskAssessment.reasons,
                expires_at: riskAssessment.expires_at
              }
            }
          };

          res.status(202).json(response);
          return;
        }

        logger.info('Risk control approved, proceeding with batch operation', {
          operation_id: batchRequest.operation_id
        });
      }

      // 在事务中执行所有操作
      const results = await this.dbService.executeInTransaction(async () => {
        const operationResults: any[] = [];

        for (const operation of batchRequest.operations) {
          let result: any;

          switch (operation.action) {
            case DatabaseAction.SELECT:
              result = await this.handleSelectOperation({
                table: operation.table,
                conditions: operation.conditions,
                action: operation.action
              });
              break;
            case DatabaseAction.INSERT:
              result = await this.handleInsertOperation({
                table: operation.table,
                data: operation.data,
                action: operation.action
              });
              break;
            case DatabaseAction.UPDATE:
              result = await this.handleUpdateOperation({
                table: operation.table,
                data: operation.data,
                conditions: operation.conditions,
                action: operation.action
              });
              break;
            case DatabaseAction.DELETE:
              result = await this.handleDeleteOperation({
                table: operation.table,
                conditions: operation.conditions,
                action: operation.action
              });
              break;
            default:
              throw new Error(`Unsupported database action: ${operation.action}`);
          }

          operationResults.push(result);
        }

        return operationResults;
      });

      const response: BatchGatewayResponse = {
        success: true,
        operation_id: batchRequest.operation_id,
        results: results
      };

      logger.info('Batch database operation completed successfully', {
        operation_id: batchRequest.operation_id,
        operation_count: results.length
      });

      res.json(response);

    } catch (error) {
      logger.error('Batch database operation failed', {
        operation_id: batchRequest.operation_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      const response: BatchGatewayResponse = {
        success: false,
        operation_id: batchRequest.operation_id,
        error: {
          code: 'BATCH_OPERATION_FAILED',
          message: 'Batch database operation failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      };

      res.status(500).json(response);
    }
  };

  async close() {
    await this.dbService.close();
  }
}