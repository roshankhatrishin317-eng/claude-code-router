/**
 * API Key Pool Configuration
 * 
 * Default configuration for the API key pool system
 */

import { RotationStrategy } from '../utils/apiKeyPool';

export interface ApiKeyPoolConfig {
  enabled: boolean;
  strategy: RotationStrategy;
  healthCheckInterval?: number;
  providers: {
    [provider: string]: {
      keys: Array<{
        key: string;
        rateLimit?: {
          requestsPerMinute?: number;
          tokensPerMinute?: number;
          requestsPerDay?: number;
        };
        priority?: number;
        enabled?: boolean;
        tags?: string[];
      }>;
    };
  };
}

export const defaultApiKeyPoolConfig: ApiKeyPoolConfig = {
  enabled: false, // Opt-in
  strategy: 'least-loaded',
  healthCheckInterval: 60000, // 1 minute
  providers: {},
};

/**
 * Get API key pool configuration from user config or use defaults
 */
export function getApiKeyPoolConfig(userConfig?: any): ApiKeyPoolConfig {
  if (!userConfig?.ApiKeyPool) {
    return defaultApiKeyPoolConfig;
  }

  const poolConfig = userConfig.ApiKeyPool;

  return {
    enabled: poolConfig.enabled ?? defaultApiKeyPoolConfig.enabled,
    strategy: poolConfig.strategy || defaultApiKeyPoolConfig.strategy,
    healthCheckInterval: poolConfig.healthCheckInterval || defaultApiKeyPoolConfig.healthCheckInterval,
    providers: poolConfig.providers || {},
  };
}
