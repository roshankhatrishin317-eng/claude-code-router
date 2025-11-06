// Enhanced cache with Redis and LRU fallback

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

// Fallback LRU cache for when Redis is unavailable
class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, V>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map<K, V>();
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }
    const value = this.cache.get(key) as V;
    // Move to end to mark as recently used
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  put(key: K, value: V): void {
    if (this.cache.has(key)) {
      // If key exists, delete it to update its position
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // If cache is full, delete the least recently used item
      const leastRecentlyUsedKey = this.cache.keys().next().value;
      if (leastRecentlyUsedKey !== undefined) {
        this.cache.delete(leastRecentlyUsedKey);
      }
    }
    this.cache.set(key, value);
  }

  values(): V[] {
    return Array.from(this.cache.values());
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// Export fallback cache for backward compatibility
export const sessionUsageCache = new LRUCache<string, Usage>(100);

// Unified cache interface
export interface CacheInterface<T = any> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  clear(): Promise<number>;
  keys(pattern?: string): Promise<string[]>;
  getStats(): Promise<any>;
}

// Memory-only cache implementation
export class MemoryCache<T = any> implements CacheInterface<T> {
  private cache: LRUCache<string, T>;
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0
  };

  constructor(capacity: number = 1000) {
    this.cache = new LRUCache<string, T>(capacity);
  }

  async get(key: string): Promise<T | null> {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.stats.hits++;
      return value;
    } else {
      this.stats.misses++;
      return null;
    }
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    this.cache.put(key, value);
    this.stats.sets++;
    // TTL is ignored in memory cache
  }

  async delete(key: string): Promise<boolean> {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
    }
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    return this.cache.has(key);
  }

  async clear(): Promise<number> {
    const size = this.cache.size;
    this.cache.clear();
    return size;
  }

  async keys(pattern?: string): Promise<string[]> {
    // Memory cache doesn't support pattern matching, return all keys
    return [];
  }

  async getStats(): Promise<any> {
    return {
      ...this.stats,
      size: this.cache.size,
      type: 'memory'
    };
  }
}

export { LRUCache };
