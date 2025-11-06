import Redis from 'ioredis';
import { getRedisConfig, RedisConfig } from '../config/redis.config';
import { EventEmitter } from 'events';

export interface RedisClient {
  client: Redis;
  config: RedisConfig;
  isConnected: boolean;
  reconnectAttempts: number;
}

export class RedisManager extends EventEmitter {
  private static instance: RedisManager;
  private client: Redis | null = null;
  private config: RedisConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;

  private constructor(config: RedisConfig) {
    super();
    this.config = config;
    this.maxReconnectAttempts = config.maxRetries || 3;
  }

  public static getInstance(config?: RedisConfig): RedisManager {
    if (!RedisManager.instance) {
      if (!config) {
        throw new Error('Redis config required for first initialization');
      }
      RedisManager.instance = new RedisManager(config);
    }
    return RedisManager.instance;
  }

  public async connect(): Promise<Redis> {
    if (this.client && this.client.status === 'ready') {
      return this.client;
    }

    try {
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db,
        keyPrefix: this.config.keyPrefix,
        retryDelayOnFailover: this.config.retryDelayOnFailover,
        lazyConnect: this.config.lazyConnect,
        keepAlive: this.config.keepAlive,
        family: this.config.family,
        connectTimeout: this.config.connectTimeout,
        commandTimeout: this.config.commandTimeout,
        maxRetriesPerRequest: this.config.maxRetries,
        retryDelayOnClusterDown: 300,
        enableReadyCheck: true,
        maxLoadingTimeout: 0,
        lazyConnect: true,
      });

      // Event listeners
      this.client.on('connect', () => {
        console.log('[REDIS] Connected to Redis');
        this.reconnectAttempts = 0;
        this.emit('connected');
      });

      this.client.on('ready', () => {
        console.log('[REDIS] Redis client ready');
        this.emit('ready');
      });

      this.client.on('error', (error) => {
        console.error('[REDIS] Redis error:', error);
        this.emit('error', error);
      });

      this.client.on('close', () => {
        console.log('[REDIS] Redis connection closed');
        this.emit('disconnected');
      });

      this.client.on('reconnecting', () => {
        this.reconnectAttempts++;
        console.log(`[REDIS] Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        this.emit('reconnecting', this.reconnectAttempts);
      });

      this.client.on('end', () => {
        console.log('[REDIS] Redis connection ended');
        this.emit('end');
      });

      // Test the connection
      await this.client.ping();
      console.log('[REDIS] Successfully connected to Redis');

      return this.client;

    } catch (error) {
      console.error('[REDIS] Failed to connect to Redis:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  public getClient(): Redis | null {
    return this.client;
  }

  public isConnected(): boolean {
    return this.client?.status === 'ready' || false;
  }

  public async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    try {
      if (!this.client) {
        return { healthy: false, error: 'Redis client not initialized' };
      }

      const start = Date.now();
      await this.client.ping();
      const latency = Date.now() - start;

      return { healthy: true, latency };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  public async info(): Promise<any> {
    try {
      if (!this.client) {
        throw new Error('Redis client not initialized');
      }

      const info = await this.client.info('memory,cpu,clients,stats,replication');
      const parsed = this.parseRedisInfo(info);

      return {
        connected: this.isConnected(),
        config: this.config,
        info: parsed,
        reconnectAttempts: this.reconnectAttempts
      };
    } catch (error) {
      throw new Error(`Failed to get Redis info: ${error}`);
    }
  }

  private parseRedisInfo(info: string): Record<string, any> {
    const lines = info.split('\r\n');
    const parsed: Record<string, any> = {};

    for (const line of lines) {
      if (line.trim() && !line.startsWith('#')) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':');
        if (key && value) {
          const parsedValue = this.parseValue(value);
          parsed[key.toLowerCase()] = parsedValue;
        }
      }
    }

    return parsed;
  }

  private parseValue(value: string): any {
    // Try to parse as number
    if (/^\d+$/.test(value)) {
      return parseInt(value, 10);
    }

    // Try to parse as float
    if (/^\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }

    // Try to parse as array
    if (value.includes(',')) {
      return value.split(',').map(v => v.trim());
    }

    // Return as string
    return value;
  }

  public async flushAll(): Promise<void> {
    try {
      if (!this.client) {
        throw new Error('Redis client not initialized');
      }

      await this.client.flushdb();
      console.log('[REDIS] Database flushed successfully');
    } catch (error) {
      console.error('[REDIS] Failed to flush database:', error);
      throw error;
    }
  }

  public updateConfig(newConfig: Partial<RedisConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): RedisConfig {
    return { ...this.config };
  }
}

// Export singleton getter
export const getRedisManager = (config?: RedisConfig): RedisManager => {
  return RedisManager.getInstance(config);
};

// Redis utility functions
export class RedisUtils {
  static generateKey(prefix: string, identifier: string, suffix?: string): string {
    const parts = [prefix, identifier];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(':');
  }

  static serialize(obj: any): string {
    return JSON.stringify(obj);
  }

  static deserialize<T = any>(str: string): T | null {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  static async setWithTTL(
    client: Redis,
    key: string,
    value: any,
    ttl?: number
  ): Promise<'OK' | null> {
    const serialized = RedisUtils.serialize(value);
    if (ttl) {
      return client.setex(key, ttl, serialized);
    }
    return client.set(key, serialized);
  }

  static async getAndDeserialize<T = any>(client: Redis, key: string): Promise<T | null> {
    const value = await client.get(key);
    return value ? RedisUtils.deserialize<T>(value) : null;
  }

  static async getMultipleAndDeserialize<T = any>(
    client: Redis,
    keys: string[]
  ): Promise<Array<T | null>> {
    const values = await client.mget(...keys);
    return values.map(value => value ? RedisUtils.deserialize<T>(value) : null);
  }
}