import { Redis, RedisOptions } from 'ioredis';
import { getRedisManager } from './redis';
import { RedisUtils } from './redis';

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl?: number;
  hits: number;
  lastAccessed: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  size: number;
  hitRate: number;
  memoryUsage: number;
}

export interface CacheOptions {
  defaultTTL?: number;
  maxSize?: number;
  enableMetrics?: boolean;
  compressionEnabled?: boolean;
  compressionThreshold?: number;
}

export class RedisCache<T = any> {
  private redis: Redis;
  private keyPrefix: string;
  private defaultTTL: number;
  private enableMetrics: boolean;
  private compressionEnabled: boolean;
  private compressionThreshold: number;
  private metricsKey: string;

  constructor(
    redis: Redis,
    keyPrefix: string = 'cache',
    options: CacheOptions = {}
  ) {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
    this.defaultTTL = options.defaultTTL || 3600; // 1 hour
    this.enableMetrics = options.enableMetrics !== false;
    this.compressionEnabled = options.compressionEnabled || false;
    this.compressionThreshold = options.compressionThreshold || 1024; // 1KB
    this.metricsKey = `${keyPrefix}:metrics`;
  }

  private async updateMetrics(delta: Partial<CacheStats>): Promise<void> {
    if (!this.enableMetrics) return;

    try {
      await this.redis.hincrby(this.metricsKey, 'hits', delta.hits || 0);
      await this.redis.hincrby(this.metricsKey, 'misses', delta.misses || 0);
      await this.redis.hincrby(this.metricsKey, 'sets', delta.sets || 0);
      await this.redis.hincrby(this.metricsKey, 'deletes', delta.deletes || 0);
      await this.redis.hincrby(this.metricsKey, 'evictions', delta.evictions || 0);
    } catch (error) {
      console.error('[CACHE] Failed to update metrics:', error);
    }
  }

  private async getKeyCount(): Promise<number> {
    try {
      const pattern = `${this.keyPrefix}:*`;
      const keys = await this.redis.keys(pattern);
      // Exclude metrics key from count
      return keys.filter(key => key !== this.metricsKey).length;
    } catch (error) {
      console.error('[CACHE] Failed to get key count:', error);
      return 0;
    }
  }

  private generateCacheKey(key: string): string {
    return RedisUtils.generateKey(this.keyPrefix, key);
  }

  private async compressData(data: string): Promise<string> {
    if (!this.compressionEnabled || data.length < this.compressionThreshold) {
      return data;
    }

    try {
      // Simple compression using zlib (would need to import zlib)
      // For now, just return the data as-is
      return data;
    } catch (error) {
      console.warn('[CACHE] Compression failed, using uncompressed data:', error);
      return data;
    }
  }

  private async decompressData(data: string): Promise<string> {
    if (!this.compressionEnabled) {
      return data;
    }

    try {
      // Simple decompression using zlib (would need to import zlib)
      // For now, just return the data as-is
      return data;
    } catch (error) {
      console.warn('[CACHE] Decompression failed, returning compressed data:', error);
      return data;
    }
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(key);
      const now = Date.now();

      const entry: CacheEntry<T> = {
        data: value,
        timestamp: now,
        ttl: ttl || this.defaultTTL,
        hits: 0,
        lastAccessed: now
      };

      const serialized = RedisUtils.serialize(entry);
      const compressed = await this.compressData(serialized);

      await RedisUtils.setWithTTL(this.redis, cacheKey, compressed, ttl || this.defaultTTL);
      await this.updateMetrics({ sets: 1 });

    } catch (error) {
      console.error('[CACHE] Failed to set cache entry:', error);
      throw error;
    }
  }

  async get(key: string): Promise<T | null> {
    try {
      const cacheKey = this.generateCacheKey(key);
      const compressed = await this.redis.get(cacheKey);

      if (!compressed) {
        await this.updateMetrics({ misses: 1 });
        return null;
      }

      const decompressed = await this.decompressData(compressed);
      const entry: CacheEntry<T> | null = RedisUtils.deserialize(decompressed);

      if (!entry) {
        await this.updateMetrics({ misses: 1 });
        await this.delete(key); // Clean up corrupted entry
        return null;
      }

      // Check if entry has expired
      if (entry.ttl && (Date.now() - entry.timestamp) > (entry.ttl * 1000)) {
        await this.delete(key);
        await this.updateMetrics({ misses: 1, evictions: 1 });
        return null;
      }

      // Update access statistics
      entry.hits++;
      entry.lastAccessed = Date.now();
      const updatedSerialized = RedisUtils.serialize(entry);
      const updatedCompressed = await this.compressData(updatedSerialized);

      // Update the entry with new stats (preserve TTL)
      const remainingTTL = entry.ttl ? Math.max(0, entry.ttl - Math.floor((Date.now() - entry.timestamp) / 1000)) : undefined;
      await RedisUtils.setWithTTL(this.redis, cacheKey, updatedCompressed, remainingTTL);

      await this.updateMetrics({ hits: 1 });
      return entry.data;

    } catch (error) {
      console.error('[CACHE] Failed to get cache entry:', error);
      await this.updateMetrics({ misses: 1 });
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const cacheKey = this.generateCacheKey(key);
      const result = await this.redis.del(cacheKey) > 0;

      if (result) {
        await this.updateMetrics({ deletes: 1 });
      }

      return result;
    } catch (error) {
      console.error('[CACHE] Failed to delete cache entry:', error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const cacheKey = this.generateCacheKey(key);
      return await this.redis.exists(cacheKey) > 0;
    } catch (error) {
      console.error('[CACHE] Failed to check if key exists:', error);
      return false;
    }
  }

  async clear(): Promise<number> {
    try {
      const pattern = `${this.keyPrefix}:*`;
      const keys = await this.redis.keys(pattern);

      // Filter out metrics key
      const keysToDelete = keys.filter(key => key !== this.metricsKey);

      if (keysToDelete.length === 0) {
        return 0;
      }

      const result = await this.redis.del(...keysToDelete);

      await this.updateMetrics({
        deletes: result,
        evictions: result
      });

      return result;
    } catch (error) {
      console.error('[CACHE] Failed to clear cache:', error);
      return 0;
    }
  }

  async invalidate(pattern: string): Promise<number> {
    try {
      const searchPattern = `${this.keyPrefix}:*${pattern}*`;
      const keys = await this.redis.keys(searchPattern);

      // Filter out metrics key
      const keysToDelete = keys.filter(key => key !== this.metricsKey);

      if (keysToDelete.length === 0) {
        return 0;
      }

      const result = await this.redis.del(...keysToDelete);

      await this.updateMetrics({
        deletes: result,
        evictions: result
      });

      return result;
    } catch (error) {
      console.error('[CACHE] Failed to invalidate cache entries:', error);
      return 0;
    }
  }

  async getStats(): Promise<CacheStats> {
    try {
      const metrics = await this.redis.hmget(
        this.metricsKey,
        'hits', 'misses', 'sets', 'deletes', 'evictions'
      );

      const hits = parseInt(metrics[0] || '0');
      const misses = parseInt(metrics[1] || '0');
      const sets = parseInt(metrics[2] || '0');
      const deletes = parseInt(metrics[3] || '0');
      const evictions = parseInt(metrics[4] || '0');

      const size = await this.getKeyCount();
      const hitRate = hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;

      // Get memory usage (approximate)
      let memoryUsage = 0;
      try {
        const info = await this.redis.info('memory');
        const match = info.match(/used_memory:(\d+)/);
        if (match) {
          memoryUsage = parseInt(match[1]);
        }
      } catch (error) {
        // Memory info not available
      }

      return {
        hits,
        misses,
        sets,
        deletes,
        evictions,
        size,
        hitRate: Math.round(hitRate * 100) / 100,
        memoryUsage
      };
    } catch (error) {
      console.error('[CACHE] Failed to get cache stats:', error);
      return {
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        evictions: 0,
        size: 0,
        hitRate: 0,
        memoryUsage: 0
      };
    }
  }

  async getKeys(pattern?: string): Promise<string[]> {
    try {
      const searchPattern = pattern
        ? `${this.keyPrefix}:*${pattern}*`
        : `${this.keyPrefix}:*`;

      const keys = await this.redis.keys(searchPattern);

      // Filter out metrics key and remove prefix
      return keys
        .filter(key => key !== this.metricsKey)
        .map(key => key.substring(this.keyPrefix.length + 1));
    } catch (error) {
      console.error('[CACHE] Failed to get cache keys:', error);
      return [];
    }
  }

  async warmCache(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<number> {
    let successCount = 0;

    for (const entry of entries) {
      try {
        await this.set(entry.key, entry.value, entry.ttl);
        successCount++;
      } catch (error) {
        console.error(`[CACHE] Failed to warm cache for key ${entry.key}:`, error);
      }
    }

    return successCount;
  }

  async getMultiple(keys: string[]): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();

    for (const key of keys) {
      try {
        const value = await this.get(key);
        results.set(key, value);
      } catch (error) {
        console.error(`[CACHE] Failed to get key ${key}:`, error);
        results.set(key, null);
      }
    }

    return results;
  }

  async setMultiple(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<number> {
    let successCount = 0;

    for (const entry of entries) {
      try {
        await this.set(entry.key, entry.value, entry.ttl);
        successCount++;
      } catch (error) {
        console.error(`[CACHE] Failed to set key ${entry.key}:`, error);
      }
    }

    return successCount;
  }

  async resetMetrics(): Promise<void> {
    try {
      await this.redis.del(this.metricsKey);
    } catch (error) {
      console.error('[CACHE] Failed to reset metrics:', error);
    }
  }
}

export function createRedisCache<T = any>(
  redis: Redis,
  keyPrefix: string = 'cache',
  options?: CacheOptions
): RedisCache<T> {
  return new RedisCache<T>(redis, keyPrefix, options);
}