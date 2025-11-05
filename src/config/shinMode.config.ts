/**
 * Shin Mode Configuration
 * 
 * Default configuration for the Shin Mode sequential processing system
 */

import { ShinMode } from '../utils/shinMode';

export interface ShinModeConfig {
  enabled: boolean;
  mode: ShinMode;
  maxQueueSize: number;
  queueTimeout: number;
  keepAliveConnections: boolean;
  connectionReuseTime: number;
  providers: {
    [provider: string]: {
      maxConcurrency: number;
      enabled: boolean;
    };
  };
}

export const defaultShinModeConfig: ShinModeConfig = {
  enabled: false, // Opt-in
  mode: 'normal', // Start in normal mode
  maxQueueSize: 100,
  queueTimeout: 60000, // 1 minute
  keepAliveConnections: true,
  connectionReuseTime: 5000, // 5 seconds
  providers: {},
};

/**
 * Get Shin Mode configuration from user config or use defaults
 */
export function getShinModeConfig(userConfig?: any): ShinModeConfig {
  if (!userConfig?.ShinMode) {
    return defaultShinModeConfig;
  }

  const shinConfig = userConfig.ShinMode;

  return {
    enabled: shinConfig.enabled ?? defaultShinModeConfig.enabled,
    mode: shinConfig.mode || defaultShinModeConfig.mode,
    maxQueueSize: shinConfig.maxQueueSize || defaultShinModeConfig.maxQueueSize,
    queueTimeout: shinConfig.queueTimeout || defaultShinModeConfig.queueTimeout,
    keepAliveConnections: shinConfig.keepAliveConnections ?? defaultShinModeConfig.keepAliveConnections,
    connectionReuseTime: shinConfig.connectionReuseTime || defaultShinModeConfig.connectionReuseTime,
    providers: shinConfig.providers || {},
  };
}
