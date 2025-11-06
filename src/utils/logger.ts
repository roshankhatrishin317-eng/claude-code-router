import pino from 'pino';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';
import { getLoggingConfig, LoggingConfig } from '../config/logging.config';

export interface LoggerContext {
  correlationId?: string;
  requestId?: string;
  sessionId?: string;
  userId?: string;
  provider?: string;
  model?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  duration?: number;
  error?: Error;
  [key: string]: any;
}

export interface LoggerOptions {
  config?: LoggingConfig;
  context?: LoggerContext;
}

export class Logger {
  private pino: pino.Logger;
  private context: LoggerContext;

  constructor(options: LoggerOptions = {}) {
    const config = options.config || getLoggingConfig({});
    this.context = options.context || {};

    // Build Pino configuration
    const pinoConfig: pino.LoggerOptions = {
      level: config.level,
      timestamp: config.timestamp,
      formatters: {
        level: (label) => ({ level: label }),
        log: (object) => {
          // Merge context with log data
          const merged = { ...this.context, ...object };

          // Remove sensitive data
          if (config.redact && config.redact.length > 0) {
            return this.redactSensitiveData(merged, config.redact);
          }

          return merged;
        }
      },
      base: config.base,
      name: config.name
    };

    // Configure pretty print for development
    let transport: pino.TransportTargetOptions | undefined;
    if (config.prettyPrint) {
      transport = {
        target: 'pino-pretty',
        options: {
          colorize: config.colorize,
          translateTime: config.translateTime,
          messageFormat: config.messageFormat,
          ignore: config.base ? Object.keys(config.base) : undefined
        }
      };
    }

    // Configure file logging
    if (config.file?.enabled) {
      const logDir = config.file.dirname || join(homedir(), '.claude-code-router', 'logs');

      // Ensure log directory exists
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      const transportOptions: any = {
        target: 'pino/file',
        options: {
          destination: join(logDir, config.file.filename || 'app.log'),
          mkdir: true
        }
      };

      // Add rotation options if specified
      if (config.file.maxSize || config.file.maxFiles || config.file.interval) {
        transportOptions.target = 'pino-roll';
        transportOptions.options = {
          file: join(logDir, config.file.filename || 'app.log'),
          frequency: config.file.interval || 'daily',
          size: config.file.maxSize || '10M',
          limit: {
            count: config.file.maxFiles || 5
          }
        };
      }

      // If we already have pretty print, use multiple transports
      if (transport) {
        (pinoConfig as any).transport = {
          targets: [transport, transportOptions]
        };
      } else {
        transport = transportOptions;
        (pinoConfig as any).transport = transport;
      }
    } else if (transport) {
      (pinoConfig as any).transport = transport;
    }

    // Create logger instance
    this.pino = pino(pinoConfig);

    // Add correlation ID middleware context if enabled
    if (config.correlationId && this.context.correlationId) {
      this.pino = this.pino.child({ correlationId: this.context.correlationId });
    }
  }

  private redactSensitiveData(obj: any, redactPaths: string[]): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    const redacted = { ...obj };

    for (const path of redactPaths) {
      const keys = path.split('.');
      let current = redacted;

      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (current[key] && typeof current[key] === 'object') {
          current = current[key];
        } else {
          break;
        }
      }

      const finalKey = keys[keys.length - 1];
      if (current[finalKey] !== undefined) {
        current[finalKey] = '[REDACTED]';
      }
    }

    return redacted;
  }

  child(context: Partial<LoggerContext>): Logger {
    const mergedContext = { ...this.context, ...context };
    return new Logger({
      config: undefined, // Use parent's config
      context: mergedContext
    });
  }

  trace(message: string, data?: any): void {
    this.pino.trace(data, message);
  }

  debug(message: string, data?: any): void {
    this.pino.debug(data, message);
  }

  info(message: string, data?: any): void {
    this.pino.info(data, message);
  }

  warn(message: string, data?: any): void {
    this.pino.warn(data, message);
  }

  error(message: string, error?: Error | any, data?: any): void {
    if (error instanceof Error) {
      this.pino.error({
        ...data,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        }
      }, message);
    } else {
      this.pino.error({ ...data, error }, message);
    }
  }

  fatal(message: string, error?: Error | any, data?: any): void {
    if (error instanceof Error) {
      this.pino.fatal({
        ...data,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        }
      }, message);
    } else {
      this.pino.fatal({ ...data, error }, message);
    }
  }

  // Performance logging
  time(label: string): void {
    this.pino.debug({ label, start: Date.now() }, `Timer started: ${label}`);
  }

  timeEnd(label: string, data?: any): void {
    this.pino.info({
      label,
      end: Date.now(),
      ...data
    }, `Timer ended: ${label}`);
  }

  // Request logging
  logRequest(request: any, data?: any): void {
    const requestData = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      userAgent: request.headers['user-agent'],
      ip: request.ip || request.headers['x-forwarded-for'],
      ...data
    };

    this.info('Incoming request', requestData);
  }

  logResponse(request: any, reply: any, data?: any): void {
    const responseData = {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration: Date.now() - (request.startTime || Date.now()),
      contentLength: reply.getHeader('content-length'),
      ...data
    };

    const level = reply.statusCode >= 400 ? 'warn' : 'info';
    this[level]('Request completed', responseData);
  }

  logError(error: Error, context?: any): void {
    this.error('Error occurred', error, context);
  }

  logPerformance(operation: string, duration: number, data?: any): void {
    this.info('Performance metric', {
      operation,
      duration,
      ...data
    });
  }

  logMetrics(metrics: Record<string, any>): void {
    this.info('Metrics update', metrics);
  }

  logHealthCheck(component: string, healthy: boolean, data?: any): void {
    const level = healthy ? 'debug' : 'warn';
    this[level](`Health check: ${component}`, {
      component,
      healthy,
      ...data
    });
  }

  logCacheOperation(operation: 'hit' | 'miss' | 'set' | 'delete', key: string, data?: any): void {
    this.debug(`Cache ${operation}`, {
      operation,
      key,
      ...data
    });
  }

  logProviderOperation(provider: string, operation: string, data?: any): void {
    this.info(`Provider operation: ${operation}`, {
      provider,
      operation,
      ...data
    });
  }

  logConnectionEvent(event: 'connect' | 'disconnect' | 'error', data?: any): void {
    const level = event === 'error' ? 'error' : 'info';
    this[level](`Connection ${event}`, data);
  }

  logSecurityEvent(event: string, data?: any): void {
    this.warn(`Security event: ${event}`, data);
  }

  logConfigurationChange(component: string, changes: any): void {
    this.info(`Configuration changed: ${component}`, {
      component,
      changes
    });
  }

  getRawLogger(): pino.Logger {
    return this.pino;
  }

  getContext(): LoggerContext {
    return { ...this.context };
  }

  updateContext(context: Partial<LoggerContext>): void {
    this.context = { ...this.context, ...context };
  }
}

// Global logger instance
let globalLogger: Logger | null = null;

export function getLogger(options?: LoggerOptions): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(options);
  }
  return globalLogger;
}

export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}

// Convenience functions for backward compatibility
export const logger = getLogger();

export const trace = (message: string, data?: any) => logger.trace(message, data);
export const debug = (message: string, data?: any) => logger.debug(message, data);
export const info = (message: string, data?: any) => logger.info(message, data);
export const warn = (message: string, data?: any) => logger.warn(message, data);
export const error = (message: string, err?: Error | any, data?: any) => logger.error(message, err, data);
export const fatal = (message: string, err?: Error | any, data?: any) => logger.fatal(message, err, data);

// Performance utilities
export const timer = (label: string) => {
  logger.time(label);
  return () => logger.timeEnd(label);
};

export const measureAsync = async <T>(
  operation: string,
  fn: () => Promise<T>,
  data?: any
): Promise<T> => {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    logger.logPerformance(operation, duration, { success: true, ...data });
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logger.logPerformance(operation, duration, { success: false, error: error instanceof Error ? error.message : String(error), ...data });
    throw error;
  }
};