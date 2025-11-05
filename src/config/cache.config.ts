/**
 * Default Cache Configuration
 * 
 * This file provides default configuration for the caching system
 * Users can override these settings in their config.json
 */

import { CacheConfig } from '../utils/requestCache';
import { join } from 'path';
import { HOME_DIR } from '../constants';

export const defaultCacheConfig: CacheConfig = {
  enabled: true,
  levels: {
    memory: {
      enabled: true,
      maxSize: 1000, // 1000 entries
      ttl: 3600000, // 1 hour in milliseconds
    },
    redis: {
      enabled: false,
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      ttl: 86400000, // 24 hours in milliseconds
      password: process.env.REDIS_PASSWORD,
    },
    disk: {
      enabled: false,
      path: join(HOME_DIR, 'cache'),
      maxSize: 100 * 1024 * 1024, // 100 MB
      ttl: 86400000, // 24 hours
    },
  },
  strategy: {
    hashAlgorithm: 'sha256',
    ignoreFields: [
      'metadata.user_id',
      'metadata.timestamp',
      'stream',
    ],
    includeFields: [
      'model',
      'messages',
      'temperature',
      'max_tokens',
      'top_p',
      'system',
      'tools',
    ],
    varyBy: [
      'metadata.session',
      'metadata.project',
    ],
  },
  semantic: {
    enabled: false,
    similarityThreshold: 0.85,
    maxComparisons: 50,
  },
  invalidation: {
    patterns: [],
    ttlVariance: 300000, // 5 minutes variance to prevent thundering herd
  },
};

/**
 * Get cache configuration from user config or use defaults
 */
export function getCacheConfig(userConfig?: any): CacheConfig {
  if (!userConfig?.Cache) {
    return defaultCacheConfig;
  }

  // Merge user config with defaults
  return {
    enabled: userConfig.Cache.enabled ?? defaultCacheConfig.enabled,
    levels: {
      memory: {
        enabled: userConfig.Cache.levels?.memory?.enabled ?? defaultCacheConfig.levels.memory.enabled,
        maxSize: userConfig.Cache.levels?.memory?.maxSize ?? defaultCacheConfig.levels.memory.maxSize,
        ttl: userConfig.Cache.levels?.memory?.ttl ?? defaultCacheConfig.levels.memory.ttl,
      },
      redis: userConfig.Cache.levels?.redis?.enabled ? {
        enabled: true,
        url: userConfig.Cache.levels.redis.url || defaultCacheConfig.levels.redis!.url,
        ttl: userConfig.Cache.levels.redis.ttl || defaultCacheConfig.levels.redis!.ttl,
        password: userConfig.Cache.levels.redis.password || defaultCacheConfig.levels.redis!.password,
      } : undefined,
      disk: userConfig.Cache.levels?.disk?.enabled ? {
        enabled: true,
        path: userConfig.Cache.levels.disk.path || defaultCacheConfig.levels.disk!.path,
        maxSize: userConfig.Cache.levels.disk.maxSize || defaultCacheConfig.levels.disk!.maxSize,
        ttl: userConfig.Cache.levels.disk.ttl || defaultCacheConfig.levels.disk!.ttl,
      } : undefined,
    },
    strategy: {
      hashAlgorithm: userConfig.Cache.strategy?.hashAlgorithm || defaultCacheConfig.strategy.hashAlgorithm,
      ignoreFields: userConfig.Cache.strategy?.ignoreFields || defaultCacheConfig.strategy.ignoreFields,
      includeFields: userConfig.Cache.strategy?.includeFields || defaultCacheConfig.strategy.includeFields,
      varyBy: userConfig.Cache.strategy?.varyBy || defaultCacheConfig.strategy.varyBy,
    },
    semantic: userConfig.Cache.semantic?.enabled ? {
      enabled: true,
      similarityThreshold: userConfig.Cache.semantic.similarityThreshold || defaultCacheConfig.semantic!.similarityThreshold,
      maxComparisons: userConfig.Cache.semantic.maxComparisons || defaultCacheConfig.semantic!.maxComparisons,
    } : undefined,
    invalidation: {
      patterns: userConfig.Cache.invalidation?.patterns || defaultCacheConfig.invalidation!.patterns,
      ttlVariance: userConfig.Cache.invalidation?.ttlVariance ?? defaultCacheConfig.invalidation!.ttlVariance,
    },
  };
}
