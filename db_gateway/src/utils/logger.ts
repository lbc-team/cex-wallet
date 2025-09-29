import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

class Logger {
  private logLevel: LogLevel;
  private logStream?: NodeJS.WritableStream;

  constructor() {
    this.logLevel = this.getLogLevelFromEnv();
    this.setupLogStream();
  }

  private getLogLevelFromEnv(): LogLevel {
    const level = process.env.LOG_LEVEL?.toLowerCase();
    switch (level) {
      case 'error': return LogLevel.ERROR;
      case 'warn': return LogLevel.WARN;
      case 'info': return LogLevel.INFO;
      case 'debug': return LogLevel.DEBUG;
      default: return LogLevel.INFO;
    }
  }

  private setupLogStream() {
    try {
      const logDir = join(__dirname, '../../logs');
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      const logFile = join(logDir, `gateway-${new Date().toISOString().split('T')[0]}.log`);
      this.logStream = createWriteStream(logFile, { flags: 'a' });
    } catch (error) {
      console.error('Failed to setup log stream:', error);
    }
  }

  private formatMessage(level: string, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const metaString = meta ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaString}\n`;
  }

  private log(level: LogLevel, levelName: string, message: string, meta?: any) {
    if (level <= this.logLevel) {
      const formattedMessage = this.formatMessage(levelName, message, meta);

      // Console output
      console.log(formattedMessage.trim());

      // File output
      if (this.logStream) {
        this.logStream.write(formattedMessage);
      }
    }
  }

  error(message: string, meta?: any) {
    this.log(LogLevel.ERROR, 'ERROR', message, meta);
  }

  warn(message: string, meta?: any) {
    this.log(LogLevel.WARN, 'WARN', message, meta);
  }

  info(message: string, meta?: any) {
    this.log(LogLevel.INFO, 'INFO', message, meta);
  }

  debug(message: string, meta?: any) {
    this.log(LogLevel.DEBUG, 'DEBUG', message, meta);
  }

  close() {
    if (this.logStream) {
      this.logStream.end();
    }
  }
}

export const logger = new Logger();