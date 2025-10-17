import winston from 'winston';
import config from '../config';

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
        metaStr = '\n' + JSON.stringify(filteredMeta, null, 2);
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
