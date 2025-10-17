import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import config from '../config';
import logger from '../utils/logger';
import path from 'path';

class Database {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor() {
    // 解析数据库路径
    this.dbPath = path.resolve(__dirname, config.databaseUrl);
    logger.info('数据库路径', { dbPath: this.dbPath });
  }

  /**
   * 初始化数据库连接（只读模式）
   */
  async initConnection(): Promise<void> {
    if (this.db) {
      logger.warn('数据库已经初始化');
      return;
    }

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(
        this.dbPath,
        sqlite3.OPEN_READONLY,
        (err) => {
          if (err) {
            logger.error('数据库连接失败', { error: err.message, dbPath: this.dbPath });
            reject(err);
          } else {
            logger.info('数据库连接成功（只读模式）');
            resolve();
          }
        }
      );
    });
  }

  /**
   * 执行 SQL 查询（返回所有行）
   */
  async all(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.db) {
      throw new Error('数据库未初始化');
    }

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('查询失败', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * 执行 SQL 查询（返回单行）
   */
  async get(sql: string, params: any[] = []): Promise<any> {
    if (!this.db) {
      throw new Error('数据库未初始化');
    }

    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err, row) => {
        if (err) {
          logger.error('查询失败', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * 执行 SQL 命令（INSERT、UPDATE、DELETE）
   */
  async run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    if (!this.db) {
      throw new Error('数据库未初始化');
    }

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function (err) {
        if (err) {
          logger.error('执行失败', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve(this);
        }
      });
    });
  }

  /**
   * 开始事务
   */
  async beginTransaction(): Promise<void> {
    await this.run('BEGIN TRANSACTION');
  }

  /**
   * 提交事务
   */
  async commit(): Promise<void> {
    await this.run('COMMIT');
  }

  /**
   * 回滚事务
   */
  async rollback(): Promise<void> {
    await this.run('ROLLBACK');
  }

  /**
   * 执行事务
   */
  async executeInTransaction<T>(operation: () => Promise<T>): Promise<T> {
    await this.beginTransaction();
    try {
      const result = await operation();
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (!this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.db!.close((err) => {
        if (err) {
          logger.error('关闭数据库失败', { error: err.message });
          reject(err);
        } else {
          logger.info('数据库连接已关闭');
          this.db = null;
          resolve();
        }
      });
    });
  }
}

// 导出单例
export const database = new Database();
