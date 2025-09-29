import sqlite3 from 'sqlite3';
import path from 'path';
import logger from '../utils/logger';
import config from '../config';

export class Database {
  private db: sqlite3.Database | null = null;
  private isInitialized: boolean = false;

  constructor() {
    const dbPath = path.resolve(config.databaseUrl);
    
    this.db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        logger.error('数据库连接失败', { path: dbPath, error: err.message });
        throw err;
      } else {
        logger.info('数据库连接成功', { path: dbPath });
      }
    });
  }

  /**
   * 初始化数据库（仅验证连接，不创建表）
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // 只验证数据库连接是否正常
      await this.verifyConnection();
      this.isInitialized = true;
      logger.info('数据库初始化完成');
    } catch (error) {
      logger.error('数据库初始化失败', { error });
      throw error;
    }
  }

  /**
   * 验证数据库连接
   */
  private async verifyConnection(): Promise<void> {
    try {
      await this.get('SELECT 1 as test');
      logger.debug('数据库连接验证成功');
    } catch (error) {
      logger.error('数据库连接验证失败', { error });
      throw new Error('数据库连接验证失败');
    }
  }

  /**
   * 执行查询
   */
  async run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库连接未初始化'));
        return;
      }

      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this);
        }
      });
    });
  }

  /**
   * 查询单行
   */
  async get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库连接未初始化'));
        return;
      }

      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * 查询多行
   */
  async all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库连接未初始化'));
        return;
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
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
          logger.error('关闭数据库连接失败', { error: err.message });
          reject(err);
        } else {
          logger.info('数据库连接已关闭');
          this.db = null;
          this.isInitialized = false;
          resolve();
        }
      });
    });
  }

  /**
   * 检查表是否存在
   */
  async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        [tableName]
      );
      return !!result;
    } catch (error) {
      logger.error('检查表是否存在失败', { tableName, error });
      return false;
    }
  }

  /**
   * 获取数据库信息
   */
  async getDatabaseInfo(): Promise<{
    tables: string[];
    version: string;
    size: number;
  }> {
    try {
      const tables = await this.all(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      );
      
      const version = await this.get('SELECT sqlite_version() as version');
      
      // 获取数据库文件大小
      const sizeInfo = await this.get('PRAGMA page_count');
      const pageSize = await this.get('PRAGMA page_size');
      const size = (sizeInfo.page_count || 0) * (pageSize.page_size || 0);

      return {
        tables: tables.map((table: any) => table.name),
        version: version?.version || 'unknown',
        size
      };
    } catch (error) {
      logger.error('获取数据库信息失败', { error });
      throw error;
    }
  }
}

// 创建数据库实例
export const database = new Database();