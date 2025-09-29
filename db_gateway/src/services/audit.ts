import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';
import { AuditLog } from '../types';
import { logger } from '../utils/logger';

export class AuditService {
  private auditDb: DatabaseService;

  constructor() {
    this.auditDb = new DatabaseService();
    this.initAuditTable();
  }

  private async initAuditTable(): Promise<void> {
    try {
      await this.auditDb.connect();

      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          operation_id TEXT NOT NULL,
          operation_type TEXT NOT NULL,
          table_name TEXT NOT NULL,
          action TEXT NOT NULL,
          module TEXT NOT NULL,
          data_before TEXT,
          data_after TEXT,
          business_signer TEXT,
          risk_control_signer TEXT,
          ip_address TEXT,
          user_agent TEXT,
          timestamp INTEGER NOT NULL,
          result TEXT NOT NULL,
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      await this.auditDb.run(createTableSQL);

      const createIndexes = [
        'CREATE INDEX IF NOT EXISTS idx_audit_operation_id ON audit_logs(operation_id)',
        'CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module)',
        'CREATE INDEX IF NOT EXISTS idx_audit_result ON audit_logs(result)',
        'CREATE INDEX IF NOT EXISTS idx_audit_table_name ON audit_logs(table_name)'
      ];

      for (const indexSQL of createIndexes) {
        await this.auditDb.run(indexSQL);
      }

      logger.info('Audit table initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize audit table', { error });
      throw error;
    }
  }

  async logOperation(auditLog: Omit<AuditLog, 'id' | 'created_at'>): Promise<string> {
    const id = uuidv4();

    try {
      const insertSQL = `
        INSERT INTO audit_logs (
          id, operation_id, operation_type, table_name, action, module,
          data_before, data_after, business_signer, risk_control_signer,
          ip_address, user_agent, timestamp, result, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await this.auditDb.run(insertSQL, [
        id,
        auditLog.operation_id,
        auditLog.operation_type,
        auditLog.table_name,
        auditLog.action,
        auditLog.module,
        auditLog.data_before ? JSON.stringify(auditLog.data_before) : null,
        auditLog.data_after ? JSON.stringify(auditLog.data_after) : null,
        auditLog.business_signer,
        auditLog.risk_control_signer || null,
        auditLog.ip_address,
        auditLog.user_agent,
        auditLog.timestamp,
        auditLog.result,
        auditLog.error_message || null
      ]);

      logger.info('Audit log recorded', { audit_id: id, operation_id: auditLog.operation_id });
      return id;
    } catch (error) {
      logger.error('Failed to record audit log', { error, operation_id: auditLog.operation_id });
      throw error;
    }
  }

  async getAuditLogs(
    filters: {
      operation_id?: string;
      module?: string;
      table_name?: string;
      result?: 'success' | 'failed';
      from_timestamp?: number;
      to_timestamp?: number;
      limit?: number;
    } = {}
  ): Promise<AuditLog[]> {
    try {
      let sql = 'SELECT * FROM audit_logs WHERE 1=1';
      const params: any[] = [];

      if (filters.operation_id) {
        sql += ' AND operation_id = ?';
        params.push(filters.operation_id);
      }

      if (filters.module) {
        sql += ' AND module = ?';
        params.push(filters.module);
      }

      if (filters.table_name) {
        sql += ' AND table_name = ?';
        params.push(filters.table_name);
      }

      if (filters.result) {
        sql += ' AND result = ?';
        params.push(filters.result);
      }

      if (filters.from_timestamp) {
        sql += ' AND timestamp >= ?';
        params.push(filters.from_timestamp);
      }

      if (filters.to_timestamp) {
        sql += ' AND timestamp <= ?';
        params.push(filters.to_timestamp);
      }

      sql += ' ORDER BY created_at DESC';

      if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
      }

      const rows = await this.auditDb.query(sql, params);

      return rows.map(row => ({
        ...row,
        data_before: row.data_before ? JSON.parse(row.data_before) : null,
        data_after: row.data_after ? JSON.parse(row.data_after) : null,
        created_at: new Date(row.created_at)
      }));
    } catch (error) {
      logger.error('Failed to retrieve audit logs', { error, filters });
      throw error;
    }
  }

  async getOperationHistory(operationId: string): Promise<AuditLog[]> {
    return this.getAuditLogs({ operation_id: operationId });
  }

  async close(): Promise<void> {
    await this.auditDb.close();
  }
}