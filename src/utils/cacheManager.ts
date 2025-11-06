import { getRedisManager } from './redis';
import { createRedisCache, RedisCache } from './redisCache';
import { MemoryCache, CacheInterface } from './cache';
import { getRedisConfig } from '../config/redis.config';

export interface CacheManagerOptions {
  enableRedis?: boolean;
  enableFallback?: boolean;
  fallbackCapacity?: number;
  redisKeyPrefix?: string;
  defaultTTL?: number;
  enableMetrics?: boolean;
  enableCompression?: boolean;
}

export interface CacheManagerStats {
  enabled: boolean;
  redisEnabled: boolean;
  fallbackEnabled: boolean;
  redisStats?: any;
  fallbackStats?: any;
  totalHits: number;
  totalMisses: number;
  totalRequests: number;
  hitRate: number;
}

export class CacheManager<T = any> implements CacheInterface<T> {
  private redisCache: RedisCache<T> | null = null;
  private fallbackCache: MemoryCache<T> | null = null;
  private options: CacheManagerOptions;
  private initialized: boolean = false;
  private stats = {
    redisHits: 0,
    redisMisses: 0,
    fallbackHits: 0,
    fallbackMisses: 0
  };

  constructor(options: CacheManagerOptions = {}) {
    this.options = {
      enableRedis: true,
      enableFallback: true,
      fallbackCapacity: 1000,
      redisKeyPrefix: 'cache',
      defaultTTL: 3600,
      enableMetrics: true,
      enableCompression: false,
      ...options
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize Redis cache if enabled
      if (this.options.enableRedis) {
        const redisConfig = getRedisConfig({});
        if (redisConfig.enabled) {
          const redisManager = getRedisManager(redisConfig);
          const redisClient = await redisManager.connect();

          if (redisClient) {
            this.redisCache = createRedisCache<T>(
              redisClient,
              this.options.redisKeyPrefix,
              {
                defaultTTL: this.options.defaultTTL,
                enableMetrics: this.options.enableMetrics,
                compressionEnabled: this.options.enableCompression
              }
            );
            console.log('[CACHE-MANAGER] Redis cache initialized successfully');
          }
        }
      }

      // Initialize fallback cache if enabled
      if (this.options.enableFallback) {
        this.fallbackCache = new MemoryCache<T>(this.options.fallbackCapacity);
        console.log('[CACHE-MANAGER] Fallback cache initialized successfully');
      }

      this.initialized = true;

      // Log final configuration
      console.log('[CACHE-MANAGER] Initialization complete:', {
        redisEnabled: !!this.redisCache,
        fallbackEnabled: !!this.fallbackCache,
        options: this.options
      });

    } catch (error) {
      console.error('[CACHE-MANAGER] Failed to initialize:', error);

      // Ensure fallback cache is available even if Redis fails
      if (!this.fallbackCache && this.options.enableFallback) {
        this.fallbackCache = new MemoryCache<T>(this.options.fallbackCapacity);
        console.log('[CACHE-MANAGER] Fallback cache initialized after Redis failure');
      }

      this.initialized = true;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  async get(key: string): Promise<T | null> {
    await this.ensureInitialized();

    // Try Redis first
    if (this.redisCache) {
      try {
        const value = await this.redisCache.get(key);
        if (value !== null) {
          this.stats.redisHits++;
          return value;
        } else {
          this.stats.redisMisses++;
        }
      } catch (error) {
        console.error('[CACHE-MANAGER] Redis get failed:', error);
        // Continue to fallback
      }
    }

    // Try fallback cache
    if (this.fallbackCache) {
      try {
        const value = await this.fallbackCache.get(key);
        if (value !== null) {
          this.stats.fallbackHits++;
          // Optionally write back to Redis for next time
          if (this.redisCache) {
            try {
              await this.redisCache.set(key, value, this.options.defaultTTL);
            } catch (error) {
              // Ignore write-back errors
            }
          }
          return value;
        } else {
          this.stats.fallbackMisses++;
        }
      } catch (error) {
        console.error('[CACHE-MANAGER] Fallback get failed:', error);
      }
    }

    return null;
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    await this.ensureInitialized();

    const promises: Promise<void>[] = [];

    // Set in Redis if available
    if (this.redisCache) {
      promises.push(
        this.redisCache.set(key, value, ttl || this.options.defaultTTL).catch(error => {
          console.error('[CACHE-MANAGER] Redis set failed:', error);
        })
      );
    }

    // Set in fallback if available
    if (this.fallbackCache) {
      promises.push(
        this.fallbackCache.set(key, value, ttl || this.options.defaultTTL).catch(error => {
          console.error('[CACHE-MANAGER] Fallback set failed:', error);
        })
      );
    }

    // Execute all set operations in parallel
    await Promise.allSettled(promises);
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();

    let deleted = false;

    // Delete from Redis
    if (this.redisCache) {
      try {
        const result = await this.redisCache.delete(key);
        deleted = deleted || result;
      } catch (error) {
        console.error('[CACHE-MANAGER] Redis delete failed:', error);
      }
    }

    // Delete from fallback
    if (this.fallbackCache) {
      try {
        const result = await this.fallbackCache.delete(key);
        deleted = deleted || result;
      } catch (error) {
        console.error('[CACHE-MANAGER] Fallback delete failed:', error);
      }
    }

    return deleted;
  }

  async has(key: string): Promise<boolean> {
    await this.ensureInitialized();

    // Check Redis first
    if (this.redisCache) {
      try {
        const exists = await this.redisCache.exists(key);
        if (exists) {
          return true;
        }
      } catch (error) {
        console.error('[CACHE-MANAGER] Redis exists check failed:', error);
      }
    }

    // Check fallback
    if (this.fallbackCache) {
      try {
        return await this.fallbackCache.has(key);
      } catch (error) {
        console.error('[CACHE-MANAGER] Fallback exists check failed:', error);
      }
    }

    return false;
  }

  async clear(): Promise<number> {
    await this.ensureInitialized();

    let totalCleared = 0;

    // Clear Redis
    if (this.redisCache) {
      try {
        const cleared = await this.redisCache.clear();
        totalCleared += cleared;
      } catch (error) {
        console.error('[CACHE-MANAGER] Redis clear failed:', error);
      }
    }

    // Clear fallback
    if (this.fallbackCache) {
      try {
        const cleared = await this.fallbackCache.clear();
        totalCleared += cleared;
      } catch (error) {
        console.error('[CACHE-MANAGER] Fallback clear failed:', error);
      }
    }

    // Reset stats
    this.stats = {
      redisHits: 0,
      redisMisses: 0,
      fallbackHits: 0,
      fallbackMisses: 0
    };

    return totalCleared;
  }

  async keys(pattern?: string): Promise<string[]> {
    await this.ensureInitialized();

    // Get keys from Redis (primary source)
    if (this.redisCache) {
      try {
        return await this.redisCache.getKeys(pattern);
      } catch (error) {
        console.error('[CACHE-MANAGER] Redis keys fetch failed:', error);
      }
    }

    // Fallback to empty array if Redis is not available
    return [];
  }

  async getStats(): Promise<CacheManagerStats> {
    await this.ensureInitialized();

    const totalHits = this.stats.redisHits + this.stats.fallbackHits;
    const totalMisses = this.stats.redisMisses + this.stats.fallbackMisses;
    const totalRequests = totalHits + totalMisses;
    const hitRate = totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;

    const stats: CacheManagerStats = {
      enabled: true,
      redisEnabled: !!this.redisCache,
      fallbackEnabled: !!this.fallbackCache,
      totalHits,
      totalMisses,
      totalRequests,
      hitRate: Math.round(hitRate * 100) / 100
    };

    // Get Redis stats if available
    if (this.redisCache) {
      try {
        stats.redisStats = await this.redisCache.getStats();
      } catch (error) {
        console.error('[CACHE-MANAGER] Failed to get Redis stats:', error);
      }
    }

    // Get fallback stats if available
    if (this.fallbackCache) {
      try {
        stats.fallbackStats = await this.fallbackCache.getStats();
      } catch (error) {
        console.error('[CACHE-MANAGER] Failed to get fallback stats:', error);
      }
    }

    return stats;
  }

  async invalidate(pattern: string): Promise<number> {
    await this.ensureInitialized();

    let invalidated = 0;

    // Invalidate from Redis
    if (this.redisCache) {
      try {
        const count = await this.redisCache.invalidate(pattern);
        invalidated += count;
      } catch (error) {
        console.error('[CACHE-MANAGER] Redis invalidate failed:', error);
      }
    }

    // For fallback cache, clear keys that match pattern
    if (this.fallbackCache && pattern) {
      try {
        const keys = await this.fallbackCache.keys();
        const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
        const matchingKeys = keys.filter(key => regex.test(key));

        for (const key of matchingKeys) {
          await this.fallbackCache.delete(key);
          invalidated++;
        }
      } catch (error) {
        console.error('[CACHE-MANAGER] Fallback invalidate failed:', error);
      }
    }

    return invalidated;
  }

  async warmCache(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<number> {
    await this.ensureInitialized();

    let successCount = 0;

    // Warm Redis cache
    if (this.redisCache) {
      try {
        const redisCount = await this.redisCache.warmCache(entries);
        successCount += redisCount;
      } catch (error) {
        console.error('[CACHE-MANAGER] Redis warm cache failed:', error);
      }
    }

    // Warm fallback cache
    if (this.fallbackCache) {
      for (const entry of entries) {
        try {
          await this.fallbackCache.set(entry.key, entry.value, entry.ttl);
          successCount++;
        } catch (error) {
          console.error(`[CACHE-MANAGER] Failed to warm fallback cache for key ${entry.key}:`, error);
        }
      }
    }

    return successCount;
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    redisHealthy?: boolean;
    fallbackHealthy?: boolean;
    details?: any;
  }> {
    await this.ensureInitialized();

    const result = {
      healthy: true,
      redisHealthy: undefined as boolean | undefined,
      fallbackHealthy: undefined as boolean | undefined
    };

    // Check Redis health
    if (this.redisCache) {
      try {
        const redisManager = getRedisManager();
        const redisHealth = await redisManager.healthCheck();
        result.redisHealthy = redisHealth.healthy;
        if (!redisHealth.healthy) {
          result.healthy = false;
        }
      } catch (error) {
        result.redisHealthy = false;
        result.healthy = false;
      }
    }

    // Check fallback health (always healthy if initialized)
    if (this.fallbackCache) {
      result.fallbackHealthy = true;
    }

    // At least one cache should be healthy
    if (!result.redisHealthy && !result.fallbackHealthy) {
      result.healthy = false;
    }

    return result;
  }

  getRedisCache(): RedisCache<T> | null {
    return this.redisCache;
  }

  getFallbackCache(): MemoryCache<T> | null {
    return this.fallbackCache;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async destroy(): Promise<void> {
    if (this.redisCache) {
      // Redis cache cleanup handled by RedisManager
      this.redisCache = null;
    }

    if (this.fallbackCache) {
      await this.fallbackCache.clear();
      this.fallbackCache = null;
    }

    this.initialized = false;
  }
}

// Global cache manager instance
let globalCacheManager: CacheManager<any> | null = null;

export function getCacheManager<T = any>(options?: CacheManagerOptions): CacheManager<T> {
  if (!globalCacheManager) {
    globalCacheManager = new CacheManager<T>(options);
  }
  return globalCacheManager as CacheManager<T>;
}

export function createCacheManager<T = any>(options?: CacheManagerOptions): CacheManager<T> {
  return new CacheManager<T>(options);
}