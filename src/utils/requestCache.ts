/**
 * Multi-Layer Request/Response Caching System
 * 
 * This module implements a sophisticated caching layer with:
 * - Memory cache (LRU) for hot data
 * - Optional Redis cache for distributed caching
 * - Optional disk cache for large responses
 * - Semantic similarity caching for similar prompts
 * - Smart cache key generation
 * - Cache warming and invalidation
 */

import { LRUCache } from 'lru-cache';
import crypto from 'crypto';
import { writeFile, readFile, mkdir, unlink, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { HOME_DIR } from '../constants';

export interface CacheConfig {
  enabled: boolean;
  levels: {
    memory: {
      enabled: boolean;
      maxSize: number;
      ttl: number; // milliseconds
    };
    redis?: {
      enabled: boolean;
      url: string;
      ttl: number;
      password?: string;
    };
    disk?: {
      enabled: boolean;
      path: string;
      maxSize: number; // in bytes
      ttl: number;
    };
  };
  strategy: {
    hashAlgorithm: 'sha256' | 'md5';
    ignoreFields?: string[];
    includeFields?: string[];
    varyBy?: string[]; // Additional fields for cache variation
  };
  semantic?: {
    enabled: boolean;
    similarityThreshold: number; // 0.0 to 1.0
    maxComparisons: number;
  };
  invalidation?: {
    patterns?: string[];
    ttlVariance?: number; // Random variance to prevent thundering herd
  };
}

export interface CacheEntry {
  key: string;
  request: any;
  response: any;
  timestamp: number;
  ttl: number;
  hits: number;
  size: number;
  metadata?: {
    provider: string;
    model: string;
    sessionId?: string;
    tokens?: {
      input: number;
      output: number;
    };
  };
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalEntries: number;
  memoryUsage: number;
  diskUsage: number;
  averageResponseTime: number;
  topKeys: Array<{ key: string; hits: number }>;
}

/**
 * Memory Cache Layer using LRU
 */
class MemoryCache {
  private cache: LRUCache<string, CacheEntry>;
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
  };

  constructor(maxSize: number = 1000, ttl: number = 3600000) {
    this.cache = new LRUCache<string, CacheEntry>({
      max: maxSize,
      ttl,
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    });
  }

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (entry) {
      this.stats.hits++;
      entry.hits++;
      entry.timestamp = Date.now(); // Update last access time
      return entry;
    }
    this.stats.misses++;
    return null;
  }

  set(key: string, entry: CacheEntry): void {
    this.cache.set(key, entry);
    this.stats.sets++;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
    };
  }

  getEntries(): CacheEntry[] {
    return Array.from(this.cache.values());
  }
}

/**
 * Disk Cache Layer for large responses
 */
class DiskCache {
  private cachePath: string;
  private maxSize: number;
  private currentSize: number = 0;
  private index: Map<string, { path: string; size: number; timestamp: number }> = new Map();

  constructor(path: string, maxSize: number) {
    this.cachePath = path;
    this.maxSize = maxSize;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    if (!existsSync(this.cachePath)) {
      await mkdir(this.cachePath, { recursive: true });
    }
    await this.buildIndex();
  }

  private async buildIndex(): Promise<void> {
    try {
      const files = await readdir(this.cachePath);
      for (const file of files) {
        if (file.endsWith('.cache')) {
          const filePath = join(this.cachePath, file);
          const stats = await stat(filePath);
          const key = file.replace('.cache', '');
          this.index.set(key, {
            path: filePath,
            size: stats.size,
            timestamp: stats.mtimeMs,
          });
          this.currentSize += stats.size;
        }
      }
    } catch (error) {
      console.error('Failed to build disk cache index:', error);
    }
  }

  async get(key: string): Promise<CacheEntry | null> {
    const entry = this.index.get(key);
    if (!entry) return null;

    try {
      const data = await readFile(entry.path, 'utf8');
      return JSON.parse(data) as CacheEntry;
    } catch (error) {
      console.error('Failed to read from disk cache:', error);
      this.index.delete(key);
      return null;
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const filePath = join(this.cachePath, `${key}.cache`);
    const data = JSON.stringify(entry);
    const size = Buffer.byteLength(data);

    // Check if we need to evict old entries
    while (this.currentSize + size > this.maxSize && this.index.size > 0) {
      await this.evictOldest();
    }

    try {
      await writeFile(filePath, data, 'utf8');
      this.index.set(key, { path: filePath, size, timestamp: Date.now() });
      this.currentSize += size;
    } catch (error) {
      console.error('Failed to write to disk cache:', error);
    }
  }

  async delete(key: string): Promise<boolean> {
    const entry = this.index.get(key);
    if (!entry) return false;

    try {
      await unlink(entry.path);
      this.currentSize -= entry.size;
      this.index.delete(key);
      return true;
    } catch (error) {
      console.error('Failed to delete from disk cache:', error);
      return false;
    }
  }

  private async evictOldest(): Promise<void> {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.index.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      await this.delete(oldestKey);
    }
  }

  async clear(): Promise<void> {
    for (const key of this.index.keys()) {
      await this.delete(key);
    }
  }

  getStats() {
    return {
      entries: this.index.size,
      totalSize: this.currentSize,
      maxSize: this.maxSize,
      usagePercentage: (this.currentSize / this.maxSize) * 100,
    };
  }
}

/**
 * Redis Cache Layer (optional)
 */
class RedisCache {
  private client: any = null;
  private connected: boolean = false;
  private ttl: number;

  constructor(url: string, ttl: number = 86400000, password?: string) {
    this.ttl = Math.floor(ttl / 1000); // Convert to seconds
    this.initialize(url, password);
  }

  private async initialize(url: string, password?: string): Promise<void> {
    try {
      // Only initialize if redis module is available
      const redis = await import('redis').catch(() => null);
      if (!redis) {
        console.warn('Redis module not installed. Skipping Redis cache.');
        return;
      }

      this.client = redis.createClient({
        url,
        password,
      });

      this.client.on('error', (err: any) => {
        console.error('Redis client error:', err);
        this.connected = false;
      });

      this.client.on('connect', () => {
        console.log('Redis cache connected');
        this.connected = true;
      });

      await this.client.connect();
    } catch (error) {
      console.error('Failed to initialize Redis cache:', error);
      this.connected = false;
    }
  }

  async get(key: string): Promise<CacheEntry | null> {
    if (!this.connected || !this.client) return null;

    try {
      const data = await this.client.get(key);
      if (data) {
        return JSON.parse(data) as CacheEntry;
      }
    } catch (error) {
      console.error('Failed to get from Redis cache:', error);
    }
    return null;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    if (!this.connected || !this.client) return;

    try {
      const data = JSON.stringify(entry);
      await this.client.setEx(key, this.ttl, data);
    } catch (error) {
      console.error('Failed to set to Redis cache:', error);
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.connected || !this.client) return false;

    try {
      const result = await this.client.del(key);
      return result > 0;
    } catch (error) {
      console.error('Failed to delete from Redis cache:', error);
      return false;
    }
  }

  async clear(): Promise<void> {
    if (!this.connected || !this.client) return;

    try {
      await this.client.flushDb();
    } catch (error) {
      console.error('Failed to clear Redis cache:', error);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
    }
  }
}

/**
 * Main Request Cache Manager
 */
export class RequestCacheManager {
  private config: CacheConfig;
  private memoryCache: MemoryCache;
  private diskCache?: DiskCache;
  private redisCache?: RedisCache;
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    startTime: Date.now(),
  };

  constructor(config: CacheConfig) {
    this.config = config;

    // Initialize memory cache
    if (config.levels.memory.enabled) {
      this.memoryCache = new MemoryCache(
        config.levels.memory.maxSize,
        config.levels.memory.ttl
      );
    } else {
      this.memoryCache = new MemoryCache(0, 0); // Disabled
    }

    // Initialize disk cache
    if (config.levels.disk?.enabled) {
      const diskPath = config.levels.disk.path || join(HOME_DIR, 'cache');
      this.diskCache = new DiskCache(diskPath, config.levels.disk.maxSize);
    }

    // Initialize Redis cache
    if (config.levels.redis?.enabled) {
      this.redisCache = new RedisCache(
        config.levels.redis.url,
        config.levels.redis.ttl,
        config.levels.redis.password
      );
    }
  }

  /**
   * Generate cache key from request
   */
  generateCacheKey(request: any): string {
    const { hashAlgorithm, ignoreFields, includeFields, varyBy } = this.config.strategy;

    // Create a normalized request object
    let requestData: any = {};

    if (includeFields && includeFields.length > 0) {
      // Only include specified fields
      for (const field of includeFields) {
        if (request[field] !== undefined) {
          requestData[field] = request[field];
        }
      }
    } else {
      // Include all fields except ignored ones
      requestData = { ...request };
      if (ignoreFields) {
        for (const field of ignoreFields) {
          delete requestData[field];
        }
      }
    }

    // Add vary-by fields
    if (varyBy) {
      for (const field of varyBy) {
        const value = this.getNestedValue(request, field);
        if (value !== undefined) {
          requestData[`__vary_${field}`] = value;
        }
      }
    }

    // Normalize messages to handle minor variations
    if (requestData.messages) {
      requestData.messages = this.normalizeMessages(requestData.messages);
    }

    // Generate hash
    const dataString = JSON.stringify(requestData, this.sortKeys);
    const hash = crypto.createHash(hashAlgorithm).update(dataString).digest('hex');

    return hash;
  }

  /**
   * Normalize messages to improve cache hit rate
   */
  private normalizeMessages(messages: any[]): any[] {
    return messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' 
        ? msg.content.trim().toLowerCase() 
        : msg.content,
    }));
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Sort object keys for consistent hashing
   */
  private sortKeys(key: string, value: any): any {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((sorted: any, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {});
    }
    return value;
  }

  /**
   * Get cached response
   */
  async get(request: any): Promise<any | null> {
    if (!this.config.enabled) return null;

    const key = this.generateCacheKey(request);

    // Try memory cache first
    let entry = this.memoryCache.get(key);
    if (entry) {
      this.stats.hits++;
      console.log(`[CACHE-HIT-MEMORY] ${key.substring(0, 8)}...`);
      return entry.response;
    }

    // Try Redis cache
    if (this.redisCache && this.redisCache.isConnected()) {
      entry = await this.redisCache.get(key);
      if (entry) {
        this.stats.hits++;
        // Populate memory cache
        this.memoryCache.set(key, entry);
        console.log(`[CACHE-HIT-REDIS] ${key.substring(0, 8)}...`);
        return entry.response;
      }
    }

    // Try disk cache
    if (this.diskCache) {
      entry = await this.diskCache.get(key);
      if (entry) {
        this.stats.hits++;
        // Populate memory cache
        this.memoryCache.set(key, entry);
        console.log(`[CACHE-HIT-DISK] ${key.substring(0, 8)}...`);
        return entry.response;
      }
    }

    // Try semantic similarity search if enabled
    if (this.config.semantic?.enabled) {
      const similarEntry = await this.findSimilarEntry(request);
      if (similarEntry) {
        this.stats.hits++;
        console.log(`[CACHE-HIT-SEMANTIC] ${key.substring(0, 8)}...`);
        return similarEntry.response;
      }
    }

    this.stats.misses++;
    console.log(`[CACHE-MISS] ${key.substring(0, 8)}...`);
    return null;
  }

  /**
   * Set cached response
   */
  async set(request: any, response: any, metadata?: any): Promise<void> {
    if (!this.config.enabled) return;

    const key = this.generateCacheKey(request);
    const size = Buffer.byteLength(JSON.stringify(response));

    // Apply TTL variance to prevent thundering herd
    let ttl = this.config.levels.memory.ttl;
    if (this.config.invalidation?.ttlVariance) {
      const variance = this.config.invalidation.ttlVariance;
      ttl += Math.random() * variance - variance / 2;
    }

    const entry: CacheEntry = {
      key,
      request,
      response,
      timestamp: Date.now(),
      ttl,
      hits: 0,
      size,
      metadata,
    };

    // Store in memory cache
    if (this.config.levels.memory.enabled) {
      this.memoryCache.set(key, entry);
    }

    // Store in Redis cache
    if (this.redisCache && this.redisCache.isConnected()) {
      await this.redisCache.set(key, entry);
    }

    // Store in disk cache for large responses
    if (this.diskCache && size > 10000) { // > 10KB
      await this.diskCache.set(key, entry);
    }

    this.stats.sets++;
    console.log(`[CACHE-SET] ${key.substring(0, 8)}... (${size} bytes)`);
  }

  /**
   * Find similar cached entry using semantic similarity
   */
  private async findSimilarEntry(request: any): Promise<CacheEntry | null> {
    if (!this.config.semantic?.enabled) return null;

    const entries = this.memoryCache.getEntries();
    const maxComparisons = Math.min(
      entries.length,
      this.config.semantic.maxComparisons || 100
    );

    let bestMatch: CacheEntry | null = null;
    let bestSimilarity = 0;

    for (let i = 0; i < maxComparisons; i++) {
      const entry = entries[i];
      const similarity = this.calculateSimilarity(request, entry.request);

      if (
        similarity > bestSimilarity &&
        similarity >= this.config.semantic.similarityThreshold
      ) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    return bestMatch;
  }

  /**
   * Calculate semantic similarity between two requests
   * Simple implementation - can be enhanced with embeddings
   */
  private calculateSimilarity(req1: any, req2: any): number {
    const text1 = this.extractText(req1);
    const text2 = this.extractText(req2);

    if (!text1 || !text2) return 0;

    // Simple word-based similarity (Jaccard similarity)
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Extract text content from request for similarity comparison
   */
  private extractText(request: any): string {
    if (!request.messages) return '';

    return request.messages
      .map((msg: any) => {
        if (typeof msg.content === 'string') return msg.content;
        if (Array.isArray(msg.content)) {
          return msg.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join(' ');
        }
        return '';
      })
      .join(' ');
  }

  /**
   * Invalidate cache by pattern
   */
  async invalidate(pattern?: string): Promise<number> {
    let count = 0;

    if (!pattern) {
      // Clear all caches
      this.memoryCache.clear();
      if (this.redisCache) await this.redisCache.clear();
      if (this.diskCache) await this.diskCache.clear();
      return -1;
    }

    // Invalidate by pattern (simple contains check)
    const entries = this.memoryCache.getEntries();
    for (const entry of entries) {
      const requestStr = JSON.stringify(entry.request);
      if (requestStr.includes(pattern)) {
        this.memoryCache.delete(entry.key);
        if (this.redisCache) await this.redisCache.delete(entry.key);
        if (this.diskCache) await this.diskCache.delete(entry.key);
        count++;
      }
    }

    return count;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const memStats = this.memoryCache.getStats();
    const diskStats = this.diskCache?.getStats();

    const totalHits = this.stats.hits;
    const totalMisses = this.stats.misses;
    const totalRequests = totalHits + totalMisses;
    const hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;

    // Get top cached keys by hits
    const entries = this.memoryCache.getEntries();
    const topKeys = entries
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 10)
      .map(e => ({ key: e.key.substring(0, 16), hits: e.hits }));

    return {
      hits: totalHits,
      misses: totalMisses,
      hitRate,
      totalEntries: memStats.size,
      memoryUsage: memStats.size,
      diskUsage: diskStats?.totalSize || 0,
      averageResponseTime: 0, // Would need to track this
      topKeys,
    };
  }

  /**
   * Warm cache with common requests
   */
  async warmCache(requests: Array<{ request: any; response: any }>): Promise<void> {
    console.log(`[CACHE-WARMING] Warming cache with ${requests.length} entries...`);
    for (const { request, response } of requests) {
      await this.set(request, response);
    }
    console.log(`[CACHE-WARMING] Complete`);
  }

  /**
   * Cleanup expired entries
   */
  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    const entries = this.memoryCache.getEntries();
    for (const entry of entries) {
      if (now - entry.timestamp > entry.ttl) {
        this.memoryCache.delete(entry.key);
        if (this.redisCache) await this.redisCache.delete(entry.key);
        if (this.diskCache) await this.diskCache.delete(entry.key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Shutdown cache manager
   */
  async shutdown(): Promise<void> {
    if (this.redisCache) {
      await this.redisCache.disconnect();
    }
  }
}

// Export singleton instance
let cacheInstance: RequestCacheManager | null = null;

export function initializeCache(config: CacheConfig): RequestCacheManager {
  if (cacheInstance) {
    console.warn('Cache already initialized. Returning existing instance.');
    return cacheInstance;
  }

  cacheInstance = new RequestCacheManager(config);
  console.log('[CACHE] Initialized with config:', {
    memory: config.levels.memory.enabled,
    redis: config.levels.redis?.enabled || false,
    disk: config.levels.disk?.enabled || false,
    semantic: config.semantic?.enabled || false,
  });

  // Setup periodic cleanup
  setInterval(() => {
    cacheInstance?.cleanup().then(cleaned => {
      if (cleaned > 0) {
        console.log(`[CACHE-CLEANUP] Removed ${cleaned} expired entries`);
      }
    });
  }, 60000); // Every minute

  return cacheInstance;
}

export function getCache(): RequestCacheManager | null {
  return cacheInstance;
}
