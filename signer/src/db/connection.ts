import * as sqlite3 from 'sqlite3';
import * as path from 'path';

export class DatabaseConnection {
  private db: sqlite3.Database;
  private dbPath: string;
  private initializationPromise: Promise<void>;

  constructor() {
    // 数据库文件路径
    this.dbPath = path.join(process.cwd(), 'signer-config.db');
    this.db = new sqlite3.Database(this.dbPath);
    // 立即开始初始化表并保存Promise
    this.initializationPromise = this.initializeTables();
  }

  /**
   * 初始化数据库表
   */
  private async initializeTables(): Promise<void> {
    console.log('开始数据库表初始化...');
    
    // 串行执行数据库操作，确保顺序
    try {
      // 创建 currentIndex 表
      await new Promise<void>((resolve, reject) => {
        this.db.run(`
          CREATE TABLE IF NOT EXISTS currentIndex (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            value INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            console.error('创建 currentIndex 表失败:', err);
            reject(err);
          } else {
            console.log('创建 currentIndex 表成功');
            resolve();
          }
        });
      });

      // 创建 generatedAddresses 表
      await new Promise<void>((resolve, reject) => {
        this.db.run(`
          CREATE TABLE IF NOT EXISTS generatedAddresses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            address TEXT UNIQUE NOT NULL,
            path TEXT NOT NULL,
            index_value INTEGER NOT NULL,
            chain_type TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            console.error('创建 generatedAddresses 表失败:', err);
            reject(err);
          } else {
            console.log('创建 generatedAddresses 表成功');
            resolve();
          }
        });
      });

      // 确保 currentIndex 表有一条记录
      await new Promise<void>((resolve, reject) => {
        this.db.run(`
          INSERT OR IGNORE INTO currentIndex (id, value) VALUES (1, 0)
        `, (err) => {
          if (err) {
            console.error('插入初始数据失败:', err);
            reject(err);
          } else {
            console.log('插入初始数据成功');
            resolve();
          }
        });
      });
      
      console.log('数据库表初始化完成');
    } catch (error) {
      console.error('数据库表初始化失败:', error);
      throw error;
    }
  }

  /**
   * 等待数据库初始化完成
   */
  async waitForInitialization(): Promise<void> {
    console.log('等待数据库初始化完成...');
    // 等待真正的初始化完成
    await this.initializationPromise;
    console.log('数据库初始化完成');
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
  addGeneratedAddress(address: string, path: string, index: number, chainType: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT OR REPLACE INTO generatedAddresses (address, path, index_value, chain_type) VALUES (?, ?, ?, ?)',
        [address, path, index, chainType],
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
   * 获取第一个生成的地址（用于密码验证）
   */
  getFirstGeneratedAddress(): Promise<{ address: string; path: string; index: number } | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT address, path, index_value FROM generatedAddresses ORDER BY index_value ASC LIMIT 1',
        (err, row: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(row ? { 
              address: row.address, 
              path: row.path, 
              index: row.index_value 
            } : null);
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
