export interface FailoverConfig {
  enabled: boolean;
  providers: {
    primary: string;
    fallback: string[];
  };
  maxRetries: number;
  timeout: number;
  healthCheckInterval: number;
  retryDelay: number;
  backoffMultiplier: number;
  maxRetryDelay: number;
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    recoveryTimeout: number;
    halfOpenMaxCalls: number;
  };
  healthCheck: {
    enabled: boolean;
    timeout: number;
    retries: number;
    endpoint?: string;
    expectedStatus?: number;
  };
  metrics: {
    enabled: boolean;
    trackFailovers: boolean;
    trackLatency: boolean;
    trackErrors: boolean;
  };
}

const getFailoverConfigFromEnv = (): Partial<FailoverConfig> => {
  const config: Partial<FailoverConfig> = {};

  if (process.env.FAILOVER_ENABLED !== undefined) {
    config.enabled = process.env.FAILOVER_ENABLED === 'true';
  }
  if (process.env.FAILOVER_PRIMARY) {
    config.providers = {
      primary: process.env.FAILOVER_PRIMARY,
      fallback: process.env.FAILOVER_FALLBACK?.split(',') || []
    };
  }
  if (process.env.FAILOVER_MAX_RETRIES) {
    config.maxRetries = parseInt(process.env.FAILOVER_MAX_RETRIES);
  }
  if (process.env.FAILOVER_TIMEOUT) {
    config.timeout = parseInt(process.env.FAILOVER_TIMEOUT);
  }
  if (process.env.FAILOVER_HEALTH_CHECK_INTERVAL) {
    config.healthCheckInterval = parseInt(process.env.FAILOVER_HEALTH_CHECK_INTERVAL);
  }
  if (process.env.FAILOVER_RETRY_DELAY) {
    config.retryDelay = parseInt(process.env.FAILOVER_RETRY_DELAY);
  }
  if (process.env.FAILOVER_BACKOFF_MULTIPLIER) {
    config.backoffMultiplier = parseFloat(process.env.FAILOVER_BACKOFF_MULTIPLIER);
  }
  if (process.env.FAILOVER_MAX_RETRY_DELAY) {
    config.maxRetryDelay = parseInt(process.env.FAILOVER_MAX_RETRY_DELAY);
  }

  // Circuit breaker config
  if (process.env.FAILOVER_CIRCUIT_BREAKER_ENABLED !== undefined) {
    config.circuitBreaker = {
      enabled: process.env.FAILOVER_CIRCUIT_BREAKER_ENABLED === 'true',
      failureThreshold: parseInt(process.env.FAILOVER_CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5'),
      recoveryTimeout: parseInt(process.env.FAILOVER_CIRCUIT_BREAKER_RECOVERY_TIMEOUT || '60000'),
      halfOpenMaxCalls: parseInt(process.env.FAILOVER_CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS || '3')
    };
  }

  // Health check config
  if (process.env.FAILOVER_HEALTH_CHECK_ENABLED !== undefined) {
    config.healthCheck = {
      enabled: process.env.FAILOVER_HEALTH_CHECK_ENABLED === 'true',
      timeout: parseInt(process.env.FAILOVER_HEALTH_CHECK_TIMEOUT || '5000'),
      retries: parseInt(process.env.FAILOVER_HEALTH_CHECK_RETRIES || '3'),
      endpoint: process.env.FAILOVER_HEALTH_CHECK_ENDPOINT,
      expectedStatus: parseInt(process.env.FAILOVER_HEALTH_CHECK_EXPECTED_STATUS || '200')
    };
  }

  // Metrics config
  if (process.env.FAILOVER_METRICS_ENABLED !== undefined) {
    config.metrics = {
      enabled: process.env.FAILOVER_METRICS_ENABLED === 'true',
      trackFailovers: process.env.FAILOVER_METRICS_TRACK_FAILOVERS !== 'false',
      trackLatency: process.env.FAILOVER_METRICS_TRACK_LATENCY !== 'false',
      trackErrors: process.env.FAILOVER_METRICS_TRACK_ERRORS !== 'false'
    };
  }

  return config;
};

export const getFailoverConfig = (config: any): FailoverConfig => {
  const envConfig = getFailoverConfigFromEnv();

  const defaultConfig: FailoverConfig = {
    enabled: true,
    providers: {
      primary: 'openrouter,anthropic/claude-3.5-sonnet',
      fallback: [
        'deepseek,deepseek-chat',
        'openai,gpt-4o'
      ]
    },
    maxRetries: 2,
    timeout: 5000,
    healthCheckInterval: 30000, // 30 seconds
    retryDelay: 1000, // 1 second
    backoffMultiplier: 2,
    maxRetryDelay: 30000, // 30 seconds
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      recoveryTimeout: 60000, // 1 minute
      halfOpenMaxCalls: 3
    },
    healthCheck: {
      enabled: true,
      timeout: 5000,
      retries: 3,
      endpoint: '/v1/messages/count_tokens',
      expectedStatus: 200
    },
    metrics: {
      enabled: true,
      trackFailovers: true,
      trackLatency: true,
      trackErrors: true
    }
  };

  const mergedConfig = {
    ...defaultConfig,
    ...envConfig,
    ...config.Failover,
  };

  // Ensure providers structure is correct
  if (!mergedConfig.providers.fallback || !Array.isArray(mergedConfig.providers.fallback)) {
    mergedConfig.providers.fallback = defaultConfig.providers.fallback;
  }

  return mergedConfig;
};