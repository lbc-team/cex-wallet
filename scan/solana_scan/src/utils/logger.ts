import winston from 'winston';
import config from '../config';

// BigInt 序列化辅助函数
function bigIntReplacer(key: string, value: any): any {
  if (typeof value === 'bigint') {
    return value.toString() + 'n';
  }
  return value;
}

// 安全的 JSON 序列化函数，支持 BigInt
function safeStringify(obj: any, space?: number): string {
  try {
    return JSON.stringify(obj, bigIntReplacer, space);
  } catch (error) {
    // 如果还是失败，返回简化的错误信息
    return JSON.stringify({ error: 'Failed to stringify object', type: typeof obj }, null, space);
  }
}

// 定义日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// 控制台输出格式
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      // 过滤掉 timestamp, level, message 和 Symbol 属性
      const filteredMeta = Object.keys(meta)
        .filter(key => !['timestamp', 'level', 'message'].includes(key) && typeof key === 'string')
        .reduce((obj: any, key) => {
          obj[key] = meta[key];
          return obj;
        }, {});

      if (Object.keys(filteredMeta).length > 0) {
        metaStr = '\n' + safeStringify(filteredMeta, 2);
      }
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// 创建 logger 实例
const logger = winston.createLogger({
  level: config.logLevel,
  format: logFormat,
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: consoleFormat
    }),
    // 错误日志文件
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // 所有日志文件
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

export default logger;
