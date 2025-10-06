import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

// 确保环境变量在模块加载时就可用
dotenv.config();

export class RiskControlDB {
  private db: sqlite3.Database | null = null;
  private static instance: RiskControlDB;
  private dbPath: string;

  constructor(dbPath?: string) {
    // 使用绝对路径配置，从环境变量读取或使用默认路径
    this.dbPath = dbPath ||
      process.env.RISK_CONTROL_DB_PATH ||
      path.join(process.cwd(), 'data/risk_control.db');

    // 确保数据目录存在
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info('Created data directory', { path: dataDir });
    }
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
   * 连接数据库并初始化
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Failed to connect to database', { error: err });
          reject(err);
        } else {
          logger.info('Risk Control Database connected', { path: this.dbPath });

          // 启用外键约束
          this.db!.run('PRAGMA foreign_keys = ON', (err) => {
            if (err) {
              logger.error('Failed to enable foreign keys', { error: err });
              reject(err);
            } else {
              // 初始化数据库表结构
              this.initialize()
                .then(() => resolve())
                .catch((err) => reject(err));
            }
          });
        }
      });
    });
  }

  /**
   * 初始化数据库表结构
   */
  private async initialize(): Promise<void> {
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');

      // 执行 schema
      await this.exec(schema);

      logger.info('Risk Control Database schema initialized');

      // 测试环境下插入模拟黑名单数据
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        const mockBlacklistPath = path.join(__dirname, 'init_mock_backlist.sql');
        if (fs.existsSync(mockBlacklistPath)) {
          const mockBlacklistSql = fs.readFileSync(mockBlacklistPath, 'utf-8');
          await this.exec(mockBlacklistSql);
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
  getDatabase(): sqlite3.Database {
    if (!this.db) {
      throw new Error('Database not connected');
    }
    return this.db;
  }

  /**
   * 执行多个 SQL 语句（不返回结果）
   */
  async exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      this.db.exec(sql, (err) => {
        if (err) {
          logger.error('Database exec failed', { sql, error: err });
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 执行查询（返回多行）
   */
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Database query failed', { sql, params, error: err });
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }

  /**
   * 执行查询（返回单行）
   */
  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Database queryOne failed', { sql, params, error: err });
          reject(err);
        } else {
          resolve(row as T || null);
        }
      });
    });
  }

  /**
   * 执行插入操作（返回插入的 ID）
   */
  async insert(sql: string, params: any[] = []): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Database insert failed', { sql, params, error: err });
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  /**
   * 执行更新/删除操作（返回影响的行数）
   */
  async run(sql: string, params: any[] = []): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Database run failed', { sql, params, error: err });
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  /**
   * 开启事务
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.run('BEGIN TRANSACTION');
    try {
      const result = await fn();
      await this.run('COMMIT');
      return result;
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      this.db.close((err) => {
        if (err) {
          logger.error('Failed to close database', { error: err });
          reject(err);
        } else {
          logger.info('Risk Control Database connection closed');
          this.db = null;
          resolve();
        }
      });
    });
  }
}

// 导出单例实例
export const riskControlDB = RiskControlDB.getInstance();
