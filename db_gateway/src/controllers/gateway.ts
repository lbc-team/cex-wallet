import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../services/database';
import { AuditService } from '../services/audit';
import { RiskControlService, RiskAssessment } from '../services/riskControl';
import { AuthenticatedRequest } from '../middleware/signature';
import { GatewayResponse, OperationType, DatabaseAction } from '../types';
import { logger } from '../utils/logger';

export class GatewayController {
  private dbService: DatabaseService;
  private auditService: AuditService;
  public riskControlService: RiskControlService;

  constructor() {
    this.dbService = new DatabaseService();
    this.auditService = new AuditService();
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
    const auditLogId = uuidv4();

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
          const auditLogId = await this.auditService.logOperation({
            operation_id: gatewayRequest.operation_id,
            operation_type: gatewayRequest.operation_type,
            table_name: gatewayRequest.table,
            action: gatewayRequest.action,
            module: gatewayRequest.module,
            data_before: null,
            data_after: null,
            business_signer: gatewayRequest.module,
            risk_control_signer: undefined,
            ip_address: req.ip || req.connection.remoteAddress || 'unknown',
            user_agent: req.get('User-Agent') || 'unknown',
            timestamp: gatewayRequest.timestamp,
            result: 'failed',
            error_message: `Operation denied by risk control: ${riskAssessment.reasons.join(', ')}`
          });

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
            },
            audit_log_id: auditLogId
          };

          res.status(403).json(response);
          return;
        }

        // 如果需要人工审核，返回待审批状态
        if (riskAssessment.decision === 'manual_review') {
          const auditLogId = await this.auditService.logOperation({
            operation_id: gatewayRequest.operation_id,
            operation_type: gatewayRequest.operation_type,
            table_name: gatewayRequest.table,
            action: gatewayRequest.action,
            module: gatewayRequest.module,
            data_before: null,
            data_after: gatewayRequest.data,
            business_signer: gatewayRequest.module,
            risk_control_signer: 'pending_approval',
            ip_address: req.ip || req.connection.remoteAddress || 'unknown',
            user_agent: req.get('User-Agent') || 'unknown',
            timestamp: gatewayRequest.timestamp,
            result: 'failed',
            error_message: `Operation requires manual approval: ${riskAssessment.reasons.join(', ')}`
          });

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
            },
            audit_log_id: auditLogId
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
      let dataBefore: any = null;

      // 如果是更新或删除操作，先获取原始数据用于审计
      if (gatewayRequest.action === DatabaseAction.UPDATE || gatewayRequest.action === DatabaseAction.DELETE) {
        if (gatewayRequest.conditions) {
          dataBefore = await this.queryDataForAudit(gatewayRequest.table, gatewayRequest.conditions);
        }
      }

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

      // 记录审计日志
      const auditLogId = await this.auditService.logOperation({
        operation_id: gatewayRequest.operation_id,
        operation_type: gatewayRequest.operation_type,
        table_name: gatewayRequest.table,
        action: gatewayRequest.action,
        module: gatewayRequest.module,
        data_before: dataBefore,
        data_after: gatewayRequest.action !== DatabaseAction.SELECT ? gatewayRequest.data : null,
        business_signer: gatewayRequest.module,
        risk_control_signer: gatewayRequest.risk_control_signature ? 'risk_control' : undefined,
        ip_address: req.ip || req.connection.remoteAddress || 'unknown',
        user_agent: req.get('User-Agent') || 'unknown',
        timestamp: gatewayRequest.timestamp,
        result: 'success'
      });

      const response: GatewayResponse = {
        success: true,
        operation_id: gatewayRequest.operation_id,
        data: result,
        audit_log_id: auditLogId
      };

      logger.info('Database operation completed successfully', {
        operation_id: gatewayRequest.operation_id,
        audit_log_id: auditLogId
      });

      res.json(response);

    } catch (error) {
      logger.error('Database operation failed', {
        operation_id: gatewayRequest.operation_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // 记录失败的审计日志
      try {
        const auditLogId = await this.auditService.logOperation({
          operation_id: gatewayRequest.operation_id,
          operation_type: gatewayRequest.operation_type,
          table_name: gatewayRequest.table,
          action: gatewayRequest.action,
          module: gatewayRequest.module,
          data_before: null,
          data_after: null,
          business_signer: gatewayRequest.module,
          risk_control_signer: gatewayRequest.risk_control_signature ? 'risk_control' : undefined,
          ip_address: req.ip || req.connection.remoteAddress || 'unknown',
          user_agent: req.get('User-Agent') || 'unknown',
          timestamp: gatewayRequest.timestamp,
          result: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        });

        const response: GatewayResponse = {
          success: false,
          operation_id: gatewayRequest.operation_id,
          error: {
            code: 'DATABASE_OPERATION_FAILED',
            message: 'Database operation failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          audit_log_id: auditLogId
        };

        res.status(500).json(response);
      } catch (auditError) {
        logger.error('Failed to record audit log for failed operation', {
          operation_id: gatewayRequest.operation_id,
          auditError
        });

        res.status(500).json({
          success: false,
          operation_id: gatewayRequest.operation_id,
          error: {
            code: 'OPERATION_AND_AUDIT_FAILED',
            message: 'Database operation failed and audit logging failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          audit_log_id: 'audit_failed'
        });
      }
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

  private async queryDataForAudit(table: string, conditions: any): Promise<any> {
    try {
      const params: any[] = [];
      const whereClause = this.buildWhereClause(conditions, params);
      const sql = `SELECT * FROM ${table} WHERE ${whereClause}`;
      return await this.dbService.query(sql, params);
    } catch (error) {
      logger.warn('Failed to query data for audit', { table, conditions, error });
      return null;
    }
  }

  getAuditLogs = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        operation_id,
        module,
        table_name,
        result,
        from_timestamp,
        to_timestamp,
        limit
      } = req.query;

      const filters: any = {};

      if (operation_id) filters.operation_id = operation_id as string;
      if (module) filters.module = module as string;
      if (table_name) filters.table_name = table_name as string;
      if (result) filters.result = result as 'success' | 'failed';
      if (from_timestamp) filters.from_timestamp = parseInt(from_timestamp as string);
      if (to_timestamp) filters.to_timestamp = parseInt(to_timestamp as string);
      if (limit) filters.limit = parseInt(limit as string);

      const auditLogs = await this.auditService.getAuditLogs(filters);

      res.json({
        success: true,
        data: auditLogs,
        count: auditLogs.length
      });

    } catch (error) {
      logger.error('Failed to retrieve audit logs', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'AUDIT_RETRIEVAL_FAILED',
          message: 'Failed to retrieve audit logs',
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