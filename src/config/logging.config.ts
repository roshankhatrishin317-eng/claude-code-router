export interface LoggingConfig {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  prettyPrint: boolean;
  redact: string[];
  correlationId: boolean;
  timestamp: boolean;
  colorize: boolean;
  translateTime: boolean | string;
  messageFormat?: string;
  base: any;
  name?: string;
  enabled: boolean;
  file?: {
    enabled: boolean;
    filename?: string;
    dirname?: string;
    maxSize?: string;
    maxFiles?: number;
    interval?: string;
  };
  http: {
    enabled: boolean;
    logLevel?: string;
    serializers?: boolean;
  };
}

const getLoggingConfigFromEnv = (): Partial<LoggingConfig> => {
  const config: Partial<LoggingConfig> = {};

  if (process.env.LOG_LEVEL) config.level = process.env.LOG_LEVEL as any;
  if (process.env.LOG_PRETTY_PRINT !== undefined) config.prettyPrint = process.env.LOG_PRETTY_PRINT === 'true';
  if (process.env.LOG_REDACT) config.redact = process.env.LOG_REDACT.split(',');
  if (process.env.LOG_CORRELATION_ID !== undefined) config.correlationId = process.env.LOG_CORRELATION_ID === 'true';
  if (process.env.LOG_TIMESTAMP !== undefined) config.timestamp = process.env.LOG_TIMESTAMP === 'true';
  if (process.env.LOG_COLORIZE !== undefined) config.colorize = process.env.LOG_COLORIZE === 'true';
  if (process.env.LOG_ENABLED !== undefined) config.enabled = process.env.LOG_ENABLED === 'true';
  if (process.env.LOG_MESSAGE_FORMAT) config.messageFormat = process.env.LOG_MESSAGE_FORMAT;
  if (process.env.LOG_NAME) config.name = process.env.LOG_NAME;

  // File logging config
  if (process.env.LOG_FILE_ENABLED !== undefined) {
    config.file = {
      enabled: process.env.LOG_FILE_ENABLED === 'true',
      ...(process.env.LOG_FILE_FILENAME && { filename: process.env.LOG_FILE_FILENAME }),
      ...(process.env.LOG_FILE_DIRNAME && { dirname: process.env.LOG_FILE_DIRNAME }),
      ...(process.env.LOG_FILE_MAX_SIZE && { maxSize: process.env.LOG_FILE_MAX_SIZE }),
      ...(process.env.LOG_FILE_MAX_FILES && { maxFiles: parseInt(process.env.LOG_FILE_MAX_FILES) }),
      ...(process.env.LOG_FILE_INTERVAL && { interval: process.env.LOG_FILE_INTERVAL })
    };
  }

  // HTTP logging config
  if (process.env.LOG_HTTP_ENABLED !== undefined) {
    config.http = {
      enabled: process.env.LOG_HTTP_ENABLED === 'true',
      ...(process.env.LOG_HTTP_LEVEL && { logLevel: process.env.LOG_HTTP_LEVEL }),
      ...(process.env.LOG_HTTP_SERIALIZERS !== undefined && { serializers: process.env.LOG_HTTP_SERIALIZERS === 'true' })
    };
  }

  return config;
};

export const getLoggingConfig = (config: any): LoggingConfig => {
  const envConfig = getLoggingConfigFromEnv();

  const defaultConfig: LoggingConfig = {
    level: 'info',
    prettyPrint: false,
    redact: ['apiKey', 'password', 'token', 'secret', 'key', 'authorization'],
    correlationId: true,
    timestamp: true,
    colorize: false,
    translateTime: 'SYS:standard',
    base: {
      pid: process.pid,
      hostname: require('os').hostname(),
      service: 'claude-code-router'
    },
    enabled: true,
    file: {
      enabled: false,
      filename: 'app.log',
      dirname: undefined, // Will default to os.tmpdir()
      maxSize: '10M',
      maxFiles: 5,
      interval: '1d'
    },
    http: {
      enabled: true,
      logLevel: 'info',
      serializers: true
    }
  };

  const mergedConfig = {
    ...defaultConfig,
    ...envConfig,
    ...config.Logging,
  };

  return mergedConfig;
};