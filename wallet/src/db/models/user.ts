import { DatabaseConnection } from '../connection';

// 用户接口定义
export interface User {
  id?: number;
  username: string;
  email: string;
  phone?: string;
  password_hash: string;
  status: 0 | 1 | 2; // 0:正常，1:禁用，2:待审核
  kyc_status: 0 | 1 | 2 | 3; // 0:未认证，1:待审核，2:已认证，3:认证失败
  created_at?: string;
  updated_at?: string;
  last_login_at?: string;
}

// 创建用户请求接口
export interface CreateUserRequest {
  username: string;
  email: string;
  phone?: string;
  password_hash: string;
  status?: 0 | 1 | 2;
  kyc_status?: 0 | 1 | 2 | 3;
}

// 用户更新接口
export interface UpdateUserRequest {
  username?: string;
  email?: string;
  phone?: string;
  password_hash?: string;
  status?: 0 | 1 | 2;
  kyc_status?: 0 | 1 | 2 | 3;
  last_login_at?: string;
}

// 用户查询选项
export interface UserQueryOptions {
  status?: 0 | 1 | 2;
  kyc_status?: 0 | 1 | 2 | 3;
  limit?: number | undefined;
  offset?: number | undefined;
  orderBy?: 'created_at' | 'last_login_at' | 'username';
  orderDirection?: 'ASC' | 'DESC';
}

// 用户数据模型类
export class UserModel {
  private db: DatabaseConnection;

  constructor(database: DatabaseConnection) {
    this.db = database;
  }

  // 根据ID查找用户
  async findById(id: number): Promise<User | null> {
    const user = await this.db.queryOne<User>(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
    return user || null;
  }

  // 根据用户名查找用户
  async findByUsername(username: string): Promise<User | null> {
    const user = await this.db.queryOne<User>(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    return user || null;
  }

  // 根据邮箱查找用户
  async findByEmail(email: string): Promise<User | null> {
    const user = await this.db.queryOne<User>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    return user || null;
  }

  // 获取所有用户
  async findAll(options?: UserQueryOptions): Promise<User[]> {
    let sql = 'SELECT * FROM users WHERE 1=1';
    const params: any[] = [];

    // 添加过滤条件
    if (options?.status !== undefined) {
      sql += ' AND status = ?';
      params.push(options.status);
    }

    if (options?.kyc_status !== undefined) {
      sql += ' AND kyc_status = ?';
      params.push(options.kyc_status);
    }

    // 添加排序
    const orderBy = options?.orderBy || 'created_at';
    const orderDirection = options?.orderDirection || 'DESC';
    sql += ` ORDER BY ${orderBy} ${orderDirection}`;

    // 添加分页
    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      
      if (options?.offset) {
        sql += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    return await this.db.query<User>(sql, params);
  }

  // 检查用户是否存在
  async exists(id: number): Promise<boolean> {
    const result = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE id = ?',
      [id]
    );
    
    return (result?.count || 0) > 0;
  }

  // 检查用户名是否已存在
  async usernameExists(username: string): Promise<boolean> {
    const result = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE username = ?',
      [username]
    );
    
    return (result?.count || 0) > 0;
  }

  // 检查邮箱是否已存在
  async emailExists(email: string): Promise<boolean> {
    const result = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE email = ?',
      [email]
    );
    
    return (result?.count || 0) > 0;
  }

  // 获取用户统计信息
  async getStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    disabledUsers: number;
    pendingUsers: number;
    kycPendingUsers: number;
    kycVerifiedUsers: number;
  }> {
    const result = await this.db.queryOne<{
      totalUsers: number;
      activeUsers: number;
      disabledUsers: number;
      pendingUsers: number;
      kycPendingUsers: number;
      kycVerifiedUsers: number;
    }>(`
      SELECT 
        COUNT(*) as totalUsers,
        SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) as activeUsers,
        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as disabledUsers,
        SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as pendingUsers,
        SUM(CASE WHEN kyc_status = 1 THEN 1 ELSE 0 END) as kycPendingUsers,
        SUM(CASE WHEN kyc_status = 2 THEN 1 ELSE 0 END) as kycVerifiedUsers
      FROM users
    `);

    return result || {
      totalUsers: 0,
      activeUsers: 0,
      disabledUsers: 0,
      pendingUsers: 0,
      kycPendingUsers: 0,
      kycVerifiedUsers: 0
    };
  }

  // 获取安全的用户信息（不包含密码哈希）
  async findByIdSafe(id: number): Promise<Omit<User, 'password_hash'> | null> {
    const user = await this.db.queryOne<Omit<User, 'password_hash'>>(
      'SELECT id, username, email, phone, status, kyc_status, created_at, updated_at, last_login_at FROM users WHERE id = ?',
      [id]
    );
    return user || null;
  }

  // 获取所有安全的用户信息（不包含密码哈希）
  async findAllSafe(options?: UserQueryOptions): Promise<Omit<User, 'password_hash'>[]> {
    let sql = 'SELECT id, username, email, phone, status, kyc_status, created_at, updated_at, last_login_at FROM users WHERE 1=1';
    const params: any[] = [];

    // 添加过滤条件
    if (options?.status !== undefined) {
      sql += ' AND status = ?';
      params.push(options.status);
    }

    if (options?.kyc_status !== undefined) {
      sql += ' AND kyc_status = ?';
      params.push(options.kyc_status);
    }

    // 添加排序
    const orderBy = options?.orderBy || 'created_at';
    const orderDirection = options?.orderDirection || 'DESC';
    sql += ` ORDER BY ${orderBy} ${orderDirection}`;

    // 添加分页
    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      
      if (options?.offset) {
        sql += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    return await this.db.query<Omit<User, 'password_hash'>>(sql, params);
  }
}
