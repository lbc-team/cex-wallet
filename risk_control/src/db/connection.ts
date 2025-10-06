import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

export class RiskControlDB {
  private db: Database.Database;
  private static instance: RiskControlDB;

  constructor(dbPath?: string) {
    const actualDbPath = dbPath || path.join(__dirname, '../../data/risk_control.db');

    // 确保数据目录存在
    const dataDir = path.dirname(actualDbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info('Created data directory', { path: dataDir });
    }

    this.db = new Database(actualDbPath);
    this.db.pragma('journal_mode = WAL'); // 使用 WAL 模式提升性能
    this.db.pragma('foreign_keys = ON'); // 启用外键约束

    logger.info('Risk Control Database initialized', { path: actualDbPath });

    // 初始化数据库表结构
    this.initialize();
  }

  /**
   * 获取单例实例
   */
  static getInstance(dbPath?: string): RiskControlDB {
    if (!RiskControlDB.instance) {
      RiskControlDB.instance = new RiskControlDB(dbPath);
    }
    return RiskControlDB.instance;
  }

  /**
   * 初始化数据库表结构
   */
  private initialize() {
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');

      // 执行 schema
      this.db.exec(schema);

      logger.info('Risk Control Database schema initialized');

      // 测试环境下插入模拟黑名单数据
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        const mockBlacklistPath = path.join(__dirname, 'init_mock_backlist.sql');
        if (fs.existsSync(mockBlacklistPath)) {
          const mockBlacklistSql = fs.readFileSync(mockBlacklistPath, 'utf-8');
          this.db.exec(mockBlacklistSql);
          logger.info('Mock blacklist data initialized for testing');
        }
      }
    } catch (error) {
      logger.error('Failed to initialize database schema', { error });
      throw error;
    }
  }

  /**
   * 获取原始数据库实例
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * 执行查询（返回多行）
   */
  query<T = any>(sql: string, params: any[] = []): T[] {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params) as T[];
    } catch (error) {
      logger.error('Database query failed', { sql, params, error });
      throw error;
    }
  }

  /**
   * 执行查询（返回单行）
   */
  queryOne<T = any>(sql: string, params: any[] = []): T | null {
    try {
      const stmt = this.db.prepare(sql);
      return (stmt.get(...params) as T) || null;
    } catch (error) {
      logger.error('Database queryOne failed', { sql, params, error });
      throw error;
    }
  }

  /**
   * 执行插入操作（返回插入的 ID）
   */
  insert(sql: string, params: any[] = []): number {
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return Number(result.lastInsertRowid);
    } catch (error) {
      logger.error('Database insert failed', { sql, params, error });
      throw error;
    }
  }

  /**
   * 执行更新/删除操作（返回影响的行数）
   */
  run(sql: string, params: any[] = []): number {
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return result.changes;
    } catch (error) {
      logger.error('Database run failed', { sql, params, error });
      throw error;
    }
  }

  /**
   * 开启事务
   */
  transaction<T>(fn: () => T): T {
    const txn = this.db.transaction(fn);
    return txn();
  }

  /**
   * 关闭数据库连接
   */
  close() {
    this.db.close();
    logger.info('Risk Control Database connection closed');
  }
}

// 导出单例实例
export const riskControlDB = RiskControlDB.getInstance();
