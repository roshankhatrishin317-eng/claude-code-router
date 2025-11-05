/**
 * API Key Pool Manager
 * 
 * Manages multiple API keys per provider to bypass rate limits and improve throughput.
 * Features:
 * - Multiple rotation strategies (round-robin, LRU, least-loaded, weighted)
 * - Health monitoring per key
 * - Automatic rate limit handling
 * - Per-key metrics and analytics
 * - Automatic failover
 */

import { EventEmitter } from 'events';

export type RotationStrategy = 'round-robin' | 'lru' | 'least-loaded' | 'weighted';
export type KeyHealth = 'healthy' | 'degraded' | 'rate-limited' | 'unavailable';

export interface ApiKeyConfig {
  key: string;
  provider: string;
  rateLimit?: {
    requestsPerMinute?: number;
    tokensPerMinute?: number;
    requestsPerDay?: number;
  };
  priority: number; // Higher = preferred (for weighted strategy)
  enabled: boolean;
  tags?: string[]; // For categorization (e.g., 'production', 'development')
}

export interface ApiKeyMetrics {
  key: string; // Masked version for display
  keyHash: string; // Full hash for internal tracking
  provider: string;
  requestCount: number;
  tokenCount: number;
  errorCount: number;
  rateLimitCount: number;
  successCount: number;
  lastUsed: number;
  lastError?: number;
  health: KeyHealth;
  rateLimitResetTime?: number;
  averageLatency: number;
  totalLatency: number;
  healthScore: number; // 0-100
}

export interface PoolStats {
  totalKeys: number;
  healthyKeys: number;
  degradedKeys: number;
  rateLimitedKeys: number;
  unavailableKeys: number;
  totalRequests: number;
  totalErrors: number;
  averageHealthScore: number;
  keyUtilization: Record<string, number>; // key -> usage percentage
}

export interface KeySelectionResult {
  key: string;
  keyHash: string;
  config: ApiKeyConfig;
  metrics: ApiKeyMetrics;
}

class ApiKeyPool extends EventEmitter {
  private keys: Map<string, ApiKeyConfig> = new Map(); // keyHash -> config
  private metrics: Map<string, ApiKeyMetrics> = new Map(); // keyHash -> metrics
  private providerKeys: Map<string, Set<string>> = new Map(); // provider -> keyHashes
  private rotationIndex: Map<string, number> = new Map(); // provider -> current index
  private strategy: RotationStrategy = 'least-loaded';
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly HEALTH_CHECK_INTERVAL = 60000; // 1 minute
  private readonly RATE_LIMIT_BUFFER = 5000; // 5 seconds buffer before reset

  constructor(strategy: RotationStrategy = 'least-loaded') {
    super();
    this.strategy = strategy;
    this.startHealthCheck();
  }

  /**
   * Add API key to the pool
   */
  addKey(config: ApiKeyConfig): void {
    const keyHash = this.hashKey(config.key);
    
    if (this.keys.has(keyHash)) {
      console.warn(`[API-KEY-POOL] Key already exists for provider ${config.provider}, updating...`);
    }

    this.keys.set(keyHash, config);

    // Initialize metrics
    if (!this.metrics.has(keyHash)) {
      this.metrics.set(keyHash, {
        key: this.maskKey(config.key),
        keyHash,
        provider: config.provider,
        requestCount: 0,
        tokenCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        successCount: 0,
        lastUsed: 0,
        health: 'healthy',
        averageLatency: 0,
        totalLatency: 0,
        healthScore: 100,
      });
    }

    // Track provider keys
    if (!this.providerKeys.has(config.provider)) {
      this.providerKeys.set(config.provider, new Set());
    }
    this.providerKeys.get(config.provider)!.add(keyHash);

    console.log(`[API-KEY-POOL] Added key ${this.maskKey(config.key)} for provider ${config.provider}`);
    this.emit('keyAdded', { provider: config.provider, keyHash });
  }

  /**
   * Remove API key from pool
   */
  removeKey(provider: string, key: string): boolean {
    const keyHash = this.hashKey(key);
    
    if (!this.keys.has(keyHash)) {
      return false;
    }

    this.keys.delete(keyHash);
    this.metrics.delete(keyHash);
    this.providerKeys.get(provider)?.delete(keyHash);

    console.log(`[API-KEY-POOL] Removed key ${this.maskKey(key)} for provider ${provider}`);
    this.emit('keyRemoved', { provider, keyHash });
    
    return true;
  }

  /**
   * Get next available API key based on strategy
   */
  getKey(provider: string, estimatedTokens: number = 0): KeySelectionResult | null {
    const providerKeyHashes = this.providerKeys.get(provider);
    
    if (!providerKeyHashes || providerKeyHashes.size === 0) {
      console.warn(`[API-KEY-POOL] No keys available for provider ${provider}`);
      return null;
    }

    // Get available keys (enabled, healthy, not rate limited)
    const availableKeys = Array.from(providerKeyHashes)
      .map(hash => ({
        hash,
        config: this.keys.get(hash)!,
        metrics: this.metrics.get(hash)!,
      }))
      .filter(({ config, metrics }) => {
        return config.enabled && 
               this.isKeyAvailable(metrics, estimatedTokens);
      });

    if (availableKeys.length === 0) {
      console.warn(`[API-KEY-POOL] No available keys for provider ${provider} (all rate limited or disabled)`);
      this.emit('noKeysAvailable', { provider });
      return null;
    }

    // Select key based on strategy
    let selectedKey;
    switch (this.strategy) {
      case 'round-robin':
        selectedKey = this.selectRoundRobin(provider, availableKeys);
        break;
      case 'lru':
        selectedKey = this.selectLRU(availableKeys);
        break;
      case 'least-loaded':
        selectedKey = this.selectLeastLoaded(availableKeys, estimatedTokens);
        break;
      case 'weighted':
        selectedKey = this.selectWeighted(availableKeys);
        break;
      default:
        selectedKey = availableKeys[0];
    }

    if (selectedKey) {
      console.log(`[API-KEY-POOL] Selected key ${selectedKey.metrics.key} for ${provider} using ${this.strategy} strategy`);
      return {
        key: selectedKey.config.key,
        keyHash: selectedKey.hash,
        config: selectedKey.config,
        metrics: selectedKey.metrics,
      };
    }

    return null;
  }

  /**
   * Record successful API key usage
   */
  recordUsage(keyHash: string, tokens: number, latency: number, success: boolean = true): void {
    const metrics = this.metrics.get(keyHash);
    if (!metrics) return;

    metrics.requestCount++;
    metrics.tokenCount += tokens;
    metrics.lastUsed = Date.now();
    metrics.totalLatency += latency;
    metrics.averageLatency = metrics.totalLatency / metrics.requestCount;

    if (success) {
      metrics.successCount++;
      // Improve health score on success
      metrics.healthScore = Math.min(100, metrics.healthScore + 1);
      if (metrics.health === 'degraded' && metrics.healthScore > 80) {
        metrics.health = 'healthy';
        this.emit('keyRecovered', { keyHash, provider: metrics.provider });
      }
    } else {
      metrics.errorCount++;
      // Degrade health score on error
      metrics.healthScore = Math.max(0, metrics.healthScore - 5);
      if (metrics.healthScore < 50) {
        metrics.health = 'degraded';
        this.emit('keyDegraded', { keyHash, provider: metrics.provider });
      }
    }

    this.emit('keyUsed', { keyHash, tokens, success, latency });
  }

  /**
   * Mark key as rate limited
   */
  markRateLimited(keyHash: string, resetTime?: number): void {
    const metrics = this.metrics.get(keyHash);
    if (!metrics) return;

    metrics.health = 'rate-limited';
    metrics.rateLimitCount++;
    metrics.lastError = Date.now();
    metrics.healthScore = Math.max(0, metrics.healthScore - 20);

    if (resetTime) {
      metrics.rateLimitResetTime = resetTime;
    } else {
      // Default: 1 minute cooldown
      metrics.rateLimitResetTime = Date.now() + 60000;
    }

    console.warn(`[API-KEY-POOL] Key ${metrics.key} rate limited until ${new Date(metrics.rateLimitResetTime).toISOString()}`);
    this.emit('keyRateLimited', { keyHash, provider: metrics.provider, resetTime: metrics.rateLimitResetTime });
  }

  /**
   * Mark key as unavailable (e.g., invalid, expired)
   */
  markUnavailable(keyHash: string, reason?: string): void {
    const metrics = this.metrics.get(keyHash);
    if (!metrics) return;

    metrics.health = 'unavailable';
    metrics.lastError = Date.now();
    metrics.healthScore = 0;

    console.error(`[API-KEY-POOL] Key ${metrics.key} marked unavailable: ${reason || 'Unknown reason'}`);
    this.emit('keyUnavailable', { keyHash, provider: metrics.provider, reason });
  }

  /**
   * Get metrics for a specific key
   */
  getKeyMetrics(keyHash: string): ApiKeyMetrics | null {
    return this.metrics.get(keyHash) || null;
  }

  /**
   * Get all keys for a provider
   */
  getProviderKeys(provider: string): ApiKeyConfig[] {
    const keyHashes = this.providerKeys.get(provider);
    if (!keyHashes) return [];

    return Array.from(keyHashes)
      .map(hash => this.keys.get(hash))
      .filter((config): config is ApiKeyConfig => config !== undefined);
  }

  /**
   * Get pool statistics
   */
  getStats(provider?: string): PoolStats {
    const keysToAnalyze = provider 
      ? Array.from(this.providerKeys.get(provider) || [])
      : Array.from(this.metrics.keys());

    const metrics = keysToAnalyze
      .map(hash => this.metrics.get(hash))
      .filter((m): m is ApiKeyMetrics => m !== undefined);

    const totalRequests = metrics.reduce((sum, m) => sum + m.requestCount, 0);
    const keyUtilization: Record<string, number> = {};

    metrics.forEach(m => {
      keyUtilization[m.key] = totalRequests > 0 
        ? (m.requestCount / totalRequests) * 100 
        : 0;
    });

    return {
      totalKeys: metrics.length,
      healthyKeys: metrics.filter(m => m.health === 'healthy').length,
      degradedKeys: metrics.filter(m => m.health === 'degraded').length,
      rateLimitedKeys: metrics.filter(m => m.health === 'rate-limited').length,
      unavailableKeys: metrics.filter(m => m.health === 'unavailable').length,
      totalRequests,
      totalErrors: metrics.reduce((sum, m) => sum + m.errorCount, 0),
      averageHealthScore: metrics.length > 0
        ? metrics.reduce((sum, m) => sum + m.healthScore, 0) / metrics.length
        : 0,
      keyUtilization,
    };
  }

  /**
   * Change rotation strategy
   */
  setStrategy(strategy: RotationStrategy): void {
    this.strategy = strategy;
    console.log(`[API-KEY-POOL] Rotation strategy changed to ${strategy}`);
    this.emit('strategyChanged', { strategy });
  }

  /**
   * Get current strategy
   */
  getStrategy(): RotationStrategy {
    return this.strategy;
  }

  /**
   * Force health check for all keys
   */
  async checkHealth(): Promise<void> {
    const now = Date.now();

    for (const [keyHash, metrics] of this.metrics.entries()) {
      // Check if rate limit has expired
      if (metrics.health === 'rate-limited' && metrics.rateLimitResetTime) {
        if (now >= metrics.rateLimitResetTime + this.RATE_LIMIT_BUFFER) {
          metrics.health = 'healthy';
          metrics.healthScore = Math.min(100, metrics.healthScore + 30);
          delete metrics.rateLimitResetTime;
          console.log(`[API-KEY-POOL] Key ${metrics.key} rate limit expired, marked healthy`);
          this.emit('keyRecovered', { keyHash, provider: metrics.provider });
        }
      }

      // Auto-recover from degraded state if no recent errors
      if (metrics.health === 'degraded' && metrics.lastError) {
        const timeSinceError = now - metrics.lastError;
        if (timeSinceError > 300000) { // 5 minutes
          metrics.healthScore = Math.min(100, metrics.healthScore + 10);
          if (metrics.healthScore > 70) {
            metrics.health = 'healthy';
            console.log(`[API-KEY-POOL] Key ${metrics.key} auto-recovered from degraded state`);
            this.emit('keyRecovered', { keyHash, provider: metrics.provider });
          }
        }
      }
    }

    this.emit('healthCheckComplete', { timestamp: now });
  }

  /**
   * Clean up and stop health checks
   */
  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.removeAllListeners();
    console.log('[API-KEY-POOL] Pool destroyed');
  }

  // ============ Private Methods ============

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.checkHealth();
    }, this.HEALTH_CHECK_INTERVAL);
  }

  private isKeyAvailable(metrics: ApiKeyMetrics, estimatedTokens: number): boolean {
    const config = this.keys.get(metrics.keyHash);
    if (!config) return false;

    // Check health status
    if (metrics.health === 'unavailable') return false;
    if (metrics.health === 'rate-limited') {
      if (metrics.rateLimitResetTime && Date.now() < metrics.rateLimitResetTime) {
        return false;
      }
    }

    // Check rate limits
    if (config.rateLimit) {
      const now = Date.now();
      const oneMinuteAgo = now - 60000;

      // Check requests per minute
      if (config.rateLimit.requestsPerMinute && metrics.lastUsed > oneMinuteAgo) {
        // This is a simplified check; in production, you'd track time-windowed counts
        const estimatedRPM = metrics.requestCount; // Simplified
        if (estimatedRPM >= config.rateLimit.requestsPerMinute) {
          return false;
        }
      }

      // Check tokens per minute
      if (config.rateLimit.tokensPerMinute && estimatedTokens > 0) {
        const availableTokens = config.rateLimit.tokensPerMinute - metrics.tokenCount;
        if (availableTokens < estimatedTokens) {
          return false;
        }
      }
    }

    return true;
  }

  private selectRoundRobin(provider: string, availableKeys: any[]): any {
    if (availableKeys.length === 0) return null;

    const currentIndex = this.rotationIndex.get(provider) || 0;
    const selected = availableKeys[currentIndex % availableKeys.length];
    this.rotationIndex.set(provider, currentIndex + 1);

    return selected;
  }

  private selectLRU(availableKeys: any[]): any {
    if (availableKeys.length === 0) return null;

    // Select the key with the oldest lastUsed timestamp
    return availableKeys.reduce((oldest, current) => {
      return current.metrics.lastUsed < oldest.metrics.lastUsed ? current : oldest;
    });
  }

  private selectLeastLoaded(availableKeys: any[], estimatedTokens: number): any {
    if (availableKeys.length === 0) return null;

    // Select key with lowest current load (request count + token count weighted)
    return availableKeys.reduce((best, current) => {
      const currentLoad = current.metrics.requestCount + (current.metrics.tokenCount / 1000);
      const bestLoad = best.metrics.requestCount + (best.metrics.tokenCount / 1000);
      return currentLoad < bestLoad ? current : best;
    });
  }

  private selectWeighted(availableKeys: any[]): any {
    if (availableKeys.length === 0) return null;

    // Weighted random selection based on priority and health score
    const weighted = availableKeys.map(key => ({
      ...key,
      weight: key.config.priority * (key.metrics.healthScore / 100),
    }));

    const totalWeight = weighted.reduce((sum, k) => sum + k.weight, 0);
    if (totalWeight === 0) return availableKeys[0];

    let random = Math.random() * totalWeight;
    for (const key of weighted) {
      random -= key.weight;
      if (random <= 0) {
        return key;
      }
    }

    return weighted[0];
  }

  private hashKey(key: string): string {
    // Simple hash for key identification (not cryptographic)
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  private maskKey(key: string): string {
    if (key.length <= 8) return '****';
    return key.substring(0, 4) + '****' + key.substring(key.length - 4);
  }
}

// Singleton instance
export const apiKeyPool = new ApiKeyPool();
