export interface RedisConfig {
  enabled: boolean;
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
  ttl: number;
  maxRetries: number;
  retryDelayOnFailover: number;
  lazyConnect: boolean;
  keepAlive: number;
  family: 4 | 6;
  connectTimeout?: number;
  commandTimeout?: number;
  maxMemoryPolicy?: string;
}

const getRedisConfigFromEnv = (): Partial<RedisConfig> => {
  const config: Partial<RedisConfig> = {};

  if (process.env.REDIS_HOST) config.host = process.env.REDIS_HOST;
  if (process.env.REDIS_PORT) config.port = parseInt(process.env.REDIS_PORT);
  if (process.env.REDIS_PASSWORD) config.password = process.env.REDIS_PASSWORD;
  if (process.env.REDIS_DB) config.db = parseInt(process.env.REDIS_DB);
  if (process.env.REDIS_KEY_PREFIX) config.keyPrefix = process.env.REDIS_KEY_PREFIX;
  if (process.env.REDIS_TTL) config.ttl = parseInt(process.env.REDIS_TTL);
  if (process.env.REDIS_MAX_RETRIES) config.maxRetries = parseInt(process.env.REDIS_MAX_RETRIES);
  if (process.env.REDIS_CONNECT_TIMEOUT) config.connectTimeout = parseInt(process.env.REDIS_CONNECT_TIMEOUT);
  if (process.env.REDIS_COMMAND_TIMEOUT) config.commandTimeout = parseInt(process.env.REDIS_COMMAND_TIMEOUT);
  if (process.env.REDIS_MAX_MEMORY_POLICY) config.maxMemoryPolicy = process.env.REDIS_MAX_MEMORY_POLICY;

  return config;
};

export const getRedisConfig = (config: any): RedisConfig => {
  const envConfig = getRedisConfigFromEnv();

  const defaultConfig: RedisConfig = {
    enabled: false,
    host: "localhost",
    port: 6379,
    db: 0,
    keyPrefix: "ccr:",
    ttl: 3600, // 1 hour
    maxRetries: 3,
    retryDelayOnFailover: 100,
    lazyConnect: true,
    keepAlive: 30000,
    family: 4,
    connectTimeout: 10000,
    commandTimeout: 5000,
    maxMemoryPolicy: "allkeys-lru"
  };

  const mergedConfig = {
    ...defaultConfig,
    ...envConfig,
    ...config.Redis,
  };

  return mergedConfig;
};