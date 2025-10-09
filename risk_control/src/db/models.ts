import { RiskControlDB } from './connection';
import { logger } from '../utils/logger';

/**
 * 风控评估记录
 */
export interface RiskAssessment {
  id?: number;
  operation_id: string;
  table_name?: string;  // 可为空，用于非数据库操作（如提现）
  record_id?: number;
  action: string;
  user_id?: number;

  operation_data: string;
  suggest_operation_data?: string;
  suggest_reason?: string;

  risk_level: 'low' | 'medium' | 'high' | 'critical';
  decision: 'auto_approve' | 'manual_review' | 'deny';
  approval_status?: 'pending' | 'approved' | 'rejected';
  reasons?: string;

  risk_signature?: string;
  expires_at?: string;

  created_at?: string;
  updated_at?: string;
}

/**
 * 人工审批记录
 */
export interface RiskManualReview {
  id?: number;
  assessment_id: number;
  operation_id: string;

  approver_user_id: number;
  approver_username?: string;
  approved: 0 | 1;

  modified_data?: string;
  comment?: string;
  ip_address?: string;
  user_agent?: string;

  created_at?: string;
}

/**
 * 地址风险记录
 */
export interface AddressRisk {
  id?: number;
  address: string;
  chain_type: 'evm' | 'btc' | 'solana';

  risk_type: 'blacklist' | 'whitelist' | 'suspicious' | 'sanctioned';
  risk_level: 'low' | 'medium' | 'high';
  reason?: string;
  source: 'manual' | 'auto' | 'chainalysis' | 'ofac';

  enabled: 0 | 1;

  created_at?: string;
  updated_at?: string;
}

/**
 * 风控评估模型
 */
export class RiskAssessmentModel {
  constructor(private db: RiskControlDB) {}

  /**
   * 创建风控评估记录
   */
  async create(data: Omit<RiskAssessment, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    const sql = `
      INSERT INTO risk_assessments (
        operation_id, table_name, record_id, action, user_id,
        operation_data, suggest_operation_data, suggest_reason,
        risk_level, decision, approval_status, reasons,
        risk_signature, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.operation_id,
      data.table_name ?? null,  // 允许为 null
      data.record_id ?? null,
      data.action,
      data.user_id ?? null,
      data.operation_data,
      data.suggest_operation_data ?? null,
      data.suggest_reason ?? null,
      data.risk_level,
      data.decision,
      data.approval_status ?? null,
      data.reasons ?? null,
      data.risk_signature ?? null,
      data.expires_at ?? null
    ];

    const id = await this.db.insert(sql, params);
    logger.info('Risk assessment created', { id, operation_id: data.operation_id });
    return id;
  }

  /**
   * 根据 operation_id 查找评估记录
   */
  async findByOperationId(operationId: string): Promise<RiskAssessment | null> {
    const sql = 'SELECT * FROM risk_assessments WHERE operation_id = ?';
    return await this.db.queryOne<RiskAssessment>(sql, [operationId]);
  }

  /**
   * 根据 ID 查找评估记录
   */
  async findById(id: number): Promise<RiskAssessment | null> {
    const sql = 'SELECT * FROM risk_assessments WHERE id = ?';
    return await this.db.queryOne<RiskAssessment>(sql, [id]);
  }

  /**
   * 查询待人工审核的记录
   */
  async findPendingReviews(limit: number = 50): Promise<RiskAssessment[]> {
    const sql = `
      SELECT * FROM risk_assessments
      WHERE decision = 'manual_review'
      AND approval_status = 'pending'
      ORDER BY created_at DESC
      LIMIT ?
    `;
    return await this.db.query<RiskAssessment>(sql, [limit]);
  }

  /**
   * 查询已批准的记录（用于通知业务层）
   */
  async findApproved(limit: number = 100): Promise<RiskAssessment[]> {
    const sql = `
      SELECT * FROM risk_assessments
      WHERE approval_status = 'approved'
      ORDER BY created_at ASC
      LIMIT ?
    `;
    return await this.db.query<RiskAssessment>(sql, [limit]);
  }

  /**
   * 更新审批状态
   */
  async updateApprovalStatus(
    operationId: string,
    status: 'approved' | 'rejected'
  ): Promise<number> {
    const sql = `
      UPDATE risk_assessments
      SET approval_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE operation_id = ?
    `;
    return await this.db.run(sql, [status, operationId]);
  }

  /**
   * 更新 record_id (业务记录创建后关联)
   */
  async updateRecordId(operationId: string, recordId: number): Promise<number> {
    const sql = `
      UPDATE risk_assessments
      SET record_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE operation_id = ?
    `;
    return await this.db.run(sql, [recordId, operationId]);
  }

  /**
   * 通用更新方法
   */
  async update(id: number, data: Partial<Omit<RiskAssessment, 'id' | 'created_at' | 'updated_at'>>): Promise<number> {
    const fields: string[] = [];
    const values: any[] = [];

    // 动态构建 SET 子句
    if (data.operation_data !== undefined) {
      fields.push('operation_data = ?');
      values.push(data.operation_data);
    }
    if (data.risk_signature !== undefined) {
      fields.push('risk_signature = ?');
      values.push(data.risk_signature);
    }
    if (data.expires_at !== undefined) {
      fields.push('expires_at = ?');
      values.push(data.expires_at);
    }
    if (data.approval_status !== undefined) {
      fields.push('approval_status = ?');
      values.push(data.approval_status);
    }
    if (data.decision !== undefined) {
      fields.push('decision = ?');
      values.push(data.decision);
    }

    if (fields.length === 0) {
      return 0; // 没有字段需要更新
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const sql = `
      UPDATE risk_assessments
      SET ${fields.join(', ')}
      WHERE id = ?
    `;

    return await this.db.run(sql, values);
  }
}

/**
 * 人工审批模型
 */
export class RiskManualReviewModel {
  constructor(private db: RiskControlDB) {}

  /**
   * 创建审批记录
   */
  async create(data: Omit<RiskManualReview, 'id' | 'created_at'>): Promise<number> {
    const sql = `
      INSERT INTO risk_manual_reviews (
        assessment_id, operation_id, approver_user_id, approver_username,
        approved, modified_data, comment, ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.assessment_id,
      data.operation_id,
      data.approver_user_id,
      data.approver_username ?? null,
      data.approved,
      data.modified_data ?? null,
      data.comment ?? null,
      data.ip_address ?? null,
      data.user_agent ?? null
    ];

    const id = await this.db.insert(sql, params);
    logger.info('Manual review created', { id, operation_id: data.operation_id });
    return id;
  }

  /**
   * 根据 operation_id 查找审批记录
   */
  async findByOperationId(operationId: string): Promise<RiskManualReview[]> {
    const sql = `
      SELECT * FROM risk_manual_reviews
      WHERE operation_id = ?
      ORDER BY created_at DESC
    `;
    return await this.db.query<RiskManualReview>(sql, [operationId]);
  }

  /**
   * 根据 assessment_id 查找审批记录
   */
  async findByAssessmentId(assessmentId: number): Promise<RiskManualReview[]> {
    const sql = `
      SELECT * FROM risk_manual_reviews
      WHERE assessment_id = ?
      ORDER BY created_at DESC
    `;
    return await this.db.query<RiskManualReview>(sql, [assessmentId]);
  }
}

/**
 * 地址风险模型
 */
export class AddressRiskModel {
  constructor(private db: RiskControlDB) {}

  /**
   * 添加风险地址
   */
  async create(data: Omit<AddressRisk, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    const sql = `
      INSERT INTO address_risk_list (
        address, chain_type, risk_type, risk_level, reason, source, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.address,
      data.chain_type,
      data.risk_type,
      data.risk_level,
      data.reason ?? null,
      data.source,
      data.enabled
    ];

    const id = await this.db.insert(sql, params);
    logger.info('Address risk added', { id, address: data.address });
    return id;
  }

  /**
   * 检查地址是否在风险列表中
   */
  async checkAddress(address: string, chainType: string): Promise<AddressRisk | null> {
    const sql = `
      SELECT * FROM address_risk_list
      WHERE LOWER(address) = LOWER(?)
      AND chain_type = ?
      AND enabled = 1
    `;
    return await this.db.queryOne<AddressRisk>(sql, [address, chainType]);
  }

  /**
   * 根据风险类型查询地址
   */
  async findByRiskType(riskType: string, chainType?: string): Promise<AddressRisk[]> {
    let sql = `
      SELECT * FROM address_risk_list
      WHERE risk_type = ? AND enabled = 1
    `;
    const params: any[] = [riskType];

    if (chainType) {
      sql += ' AND chain_type = ?';
      params.push(chainType);
    }

    sql += ' ORDER BY created_at DESC';

    return await this.db.query<AddressRisk>(sql, params);
  }

  /**
   * 启用/禁用地址风险
   */
  async toggleEnabled(id: number, enabled: 0 | 1): Promise<number> {
    const sql = `
      UPDATE address_risk_list
      SET enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    return await this.db.run(sql, [enabled, id]);
  }

  /**
   * 删除地址风险
   */
  async delete(id: number): Promise<number> {
    const sql = 'DELETE FROM address_risk_list WHERE id = ?';
    return await this.db.run(sql, [id]);
  }
}
