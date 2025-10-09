import sqlite3 from 'sqlite3';
import { join, resolve, isAbsolute } from 'path';
import { readFileSync } from 'fs';
import { logger } from '../utils/logger';

export class DatabaseService {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor() {
    // If WALLET_DB_PATH is absolute, use it directly
    // Otherwise, treat it as relative to the project root (db_gateway directory)
    if (process.env.WALLET_DB_PATH) {
      this.dbPath = isAbsolute(process.env.WALLET_DB_PATH)
        ? process.env.WALLET_DB_PATH
        : resolve(process.cwd(), process.env.WALLET_DB_PATH);
    } else {
      // Default: wallet.db in db_gateway directory
      this.dbPath = resolve(process.cwd(), 'wallet.db');
    }
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
          logger.error('Database connection failed', { path: this.dbPath, error: err.message });
          reject(err);
        } else {
          logger.info('Database connected successfully', { path: this.dbPath });
          this.setupPragmas()
            .then(() => this.initDatabase())
            .then(resolve)
            .catch(reject);
        }
      });
    });
  }

  private async setupPragmas(): Promise<void> {
    if (!this.db) return;

    const pragmas = [
      'PRAGMA journal_mode=WAL',
      'PRAGMA busy_timeout=30000',
      'PRAGMA synchronous=NORMAL',
      'PRAGMA cache_size=1000'
    ];

    for (const pragma of pragmas) {
      await this.run(pragma);
    }
  }

  private async initDatabase(): Promise<void> {
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      logger.info('开始初始化数据库表...');

      // 读取 schema.sql 文件
      const schemaPath = resolve(__dirname, '../db/schema.sql');
      const schemaSql = readFileSync(schemaPath, 'utf-8');

      // 使用 exec 方法一次性执行所有 SQL 语句
      await this.exec(schemaSql);

      logger.info('数据库表初始化完成');

    } catch (error) {
      logger.error('数据库表初始化失败', { error });
      throw error;
    }
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
          logger.error('Database exec failed', { sql: sql.substring(0, 200), error: err.message });
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }


  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      logger.debug('Executing query', { sql, params });

      this.db.all(sql, params, (err: Error | null, rows: T[]) => {
        if (err) {
          logger.error('Query execution failed', { sql, params, error: err.message });
          reject(err);
        } else {
          logger.debug('Query executed successfully', { sql, params, rowCount: rows.length });
          resolve(rows);
        }
      });
    });
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      logger.debug('Executing single query', { sql, params });

      this.db.get(sql, params, (err: Error | null, row: T | undefined) => {
        if (err) {
          logger.error('Single query execution failed', { sql, params, error: err.message });
          reject(err);
        } else {
          logger.debug('Single query executed successfully', { sql, params, found: !!row });
          resolve(row);
        }
      });
    });
  }

  async run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      logger.debug('Executing run command', { sql, params });

      this.db.run(sql, params, function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          logger.error('Run command execution failed', { sql, params, error: err.message });
          reject(err);
        } else {
          logger.debug('Run command executed successfully', {
            sql,
            params,
            lastID: this.lastID,
            changes: this.changes
          });
          resolve(this);
        }
      });
    });
  }

  async beginTransaction(): Promise<void> {
    await this.run('BEGIN TRANSACTION');
  }

  async commit(): Promise<void> {
    await this.run('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.run('ROLLBACK');
  }

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

  isConnected(): boolean {
    return this.db !== null;
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      this.db.close((err) => {
        if (err) {
          logger.error('Database close failed', { error: err.message });
          reject(err);
        } else {
          logger.info('Database connection closed');
          this.db = null;
          resolve();
        }
      });
    });
  }
}