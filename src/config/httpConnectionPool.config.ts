/**
 * HTTP Connection Pool Configuration
 * 
 * Default configuration for the HTTP connection keep-alive pool
 */

import { ConnectionPoolConfig } from '../utils/httpConnectionPool';

export interface HttpPoolConfig {
  enabled: boolean;
  global: Partial<ConnectionPoolConfig>;
  providers?: {
    [provider: string]: Partial<ConnectionPoolConfig>;
  };
}

export const defaultHttpPoolConfig: HttpPoolConfig = {
  enabled: true, // Enable by default for better performance
  global: {
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 30000,
    keepAlive: true,
    keepAliveMsecs: 60000,
    freeSocketTimeout: 15000,
    maxSocketLifetime: 600000,
  },
  providers: {},
};

/**
 * Get HTTP pool configuration from user config or use defaults
 */
export function getHttpPoolConfig(userConfig?: any): HttpPoolConfig {
  if (!userConfig?.HttpConnectionPool) {
    return defaultHttpPoolConfig;
  }

  const poolConfig = userConfig.HttpConnectionPool;

  return {
    enabled: poolConfig.enabled ?? defaultHttpPoolConfig.enabled,
    global: {
      ...defaultHttpPoolConfig.global,
      ...poolConfig.global,
    },
    providers: poolConfig.providers || {},
  };
}
