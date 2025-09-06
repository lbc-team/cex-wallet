import * as sqlite3 from 'sqlite3';
import * as path from 'path';

export class DatabaseConnection {
  private db: sqlite3.Database;
  private dbPath: string;

  constructor() {
    // 数据库文件路径
    this.dbPath = path.join(process.cwd(), 'signer-config.db');
    this.db = new sqlite3.Database(this.dbPath);
    this.initializeTables();
  }

  /**
   * 初始化数据库表
   */
  private initializeTables(): void {
    // 创建 currentIndex 表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS currentIndex (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建 generatedAddresses 表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS generatedAddresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT UNIQUE NOT NULL,
        path TEXT NOT NULL,
        index_value INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 确保 currentIndex 表有一条记录
    this.db.run(`
      INSERT OR IGNORE INTO currentIndex (id, value) VALUES (1, 0)
    `);
  }

  /**
   * 获取当前索引
   */
  getCurrentIndex(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT value FROM currentIndex WHERE id = 1',
        (err, row: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(row ? row.value : 0);
          }
        }
      );
    });
  }

  /**
   * 更新当前索引
   */
  updateCurrentIndex(index: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE currentIndex SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
        [index],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }


  /**
   * 添加生成的地址
   */
  addGeneratedAddress(address: string, path: string, index: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT OR REPLACE INTO generatedAddresses (address, path, index_value) VALUES (?, ?, ?)',
        [address, path, index],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }


  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }
}
