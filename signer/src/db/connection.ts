import * as sqlite3 from 'sqlite3';
import * as path from 'path';

export class DatabaseConnection {
  private db: sqlite3.Database;
  private dbPath: string;
  private initializationPromise: Promise<void>;

  constructor() {
    // 数据库文件路径
    this.dbPath = path.join(process.cwd(), 'signer.db');
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
   * 获取指定链类型的最大索引值
   */
  getMaxIndexForChain(chainType: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT MAX(index_value) as maxIndex FROM generatedAddresses WHERE chain_type = ?',
        [chainType],
        (err, row: any) => {
          if (err) {
            reject(err);
          } else {
            // 如果没有记录，返回 -1，这样 +1 就是 0
            resolve(row?.maxIndex ?? -1);
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
