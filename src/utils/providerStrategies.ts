/**
 * Provider-Specific Pooling Strategies and Retry Logic
 *
 * This module implements different connection pooling and retry strategies
 * tailored for each LLM provider's specific rate limits and characteristics.
 */

import { ConnectionInfo, ProviderConfig } from './sessionConnectionPool';

export interface ProviderStrategy {
  name: string;
  maxConnections: number;
  maxConcurrentRequests: number;
  retryAttempts: number;
  retryDelay: number;
  backoffMultiplier: number;
  rateLimitPerSecond: number;
  rateLimitPerMinute: number;
  connectionTimeout: number;
  requestTimeout: number;
  healthCheckInterval: number;
  keepAlive: boolean;
  customRetryCondition?: (error: any) => boolean;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryCondition: (error: any) => boolean;
}

class ProviderStrategies {
  private strategies: Map<string, ProviderStrategy> = new Map();

  constructor() {
    this.initializeDefaultStrategies();
  }

  /**
   * Initialize default strategies for known providers
   */
  private initializeDefaultStrategies(): void {
    // OpenRouter Strategy - Generous limits, but needs careful rate limiting
    this.strategies.set('openrouter', {
      name: 'openrouter',
      maxConnections: 10,
      maxConcurrentRequests: 5,
      retryAttempts: 3,
      retryDelay: 1000,
      backoffMultiplier: 2,
      rateLimitPerSecond: 20,
      rateLimitPerMinute: 500,
      connectionTimeout: 30000,
      requestTimeout: 60000,
      healthCheckInterval: 30000,
      keepAlive: true
    });

    // DeepSeek Strategy - More conservative, good for development
    this.strategies.set('deepseek', {
      name: 'deepseek',
      maxConnections: 5,
      maxConcurrentRequests: 3,
      retryAttempts: 2,
      retryDelay: 2000,
      backoffMultiplier: 1.5,
      rateLimitPerSecond: 5,
      rateLimitPerMinute: 120,
      connectionTimeout: 20000,
      requestTimeout: 45000,
      healthCheckInterval: 25000,
      keepAlive: true
    });

    // OpenAI Strategy - Strict rate limits, needs careful management
    this.strategies.set('openai', {
      name: 'openai',
      maxConnections: 3,
      maxConcurrentRequests: 2,
      retryAttempts: 5,
      retryDelay: 1500,
      backoffMultiplier: 2,
      rateLimitPerSecond: 3,
      rateLimitPerMinute: 60,
      connectionTimeout: 15000,
      requestTimeout: 30000,
      healthCheckInterval: 20000,
      keepAlive: true,
      customRetryCondition: (error: any) => {
        // Retry on rate limit errors specifically
        return error?.status === 429 ||
               error?.code === 'rate_limit_exceeded' ||
               error?.type === 'rate_limit_error';
      }
    });

    // Anthropic Strategy - Conservative with high accuracy
    this.strategies.set('anthropic', {
      name: 'anthropic',
      maxConnections: 4,
      maxConcurrentRequests: 2,
      retryAttempts: 3,
      retryDelay: 2000,
      backoffMultiplier: 2,
      rateLimitPerSecond: 4,
      rateLimitPerMinute: 80,
      connectionTimeout: 20000,
      requestTimeout: 40000,
      healthCheckInterval: 25000,
      keepAlive: true
    });

    // Google Gemini Strategy - Burst-friendly
    this.strategies.set('google', {
      name: 'google',
      maxConnections: 8,
      maxConcurrentRequests: 4,
      retryAttempts: 4,
      retryDelay: 1000,
      backoffMultiplier: 1.8,
      rateLimitPerSecond: 15,
      rateLimitPerMinute: 300,
      connectionTimeout: 25000,
      requestTimeout: 50000,
      healthCheckInterval: 30000,
      keepAlive: true
    });

    // Groq Strategy - Fast but needs careful rate limiting
    this.strategies.set('groq', {
      name: 'groq',
      maxConnections: 6,
      maxConcurrentRequests: 3,
      retryAttempts: 3,
      retryDelay: 800,
      backoffMultiplier: 2.5,
      rateLimitPerSecond: 30,
      rateLimitPerMinute: 400,
      connectionTimeout: 10000,
      requestTimeout: 25000,
      healthCheckInterval: 20000,
      keepAlive: true
    });
  }

  /**
   * Get strategy for a provider
   */
  getStrategy(providerName: string): ProviderStrategy {
    const strategy = this.strategies.get(providerName.toLowerCase());
    if (!strategy) {
      // Return a default conservative strategy for unknown providers
      return this.getDefaultStrategy();
    }
    return { ...strategy }; // Return a copy to prevent modifications
  }

  /**
   * Get default strategy for unknown providers
   */
  private getDefaultStrategy(): ProviderStrategy {
    return {
      name: 'default',
      maxConnections: 3,
      maxConcurrentRequests: 2,
      retryAttempts: 2,
      retryDelay: 2000,
      backoffMultiplier: 2,
      rateLimitPerSecond: 5,
      rateLimitPerMinute: 100,
      connectionTimeout: 30000,
      requestTimeout: 60000,
      healthCheckInterval: 30000,
      keepAlive: true
    };
  }

  /**
   * Register a custom strategy for a provider
   */
  registerStrategy(strategy: ProviderStrategy): void {
    this.strategies.set(strategy.name.toLowerCase(), { ...strategy });
  }

  /**
   * Update provider config based on strategy
   */
  applyStrategyToConfig(config: ProviderConfig): ProviderConfig {
    const strategy = this.getStrategy(config.name);

    return {
      ...config,
      maxConnections: config.maxConnections || strategy.maxConnections,
      rateLimitPerSecond: config.rateLimitPerSecond || strategy.rateLimitPerSecond,
      rateLimitPerMinute: config.rateLimitPerMinute || strategy.rateLimitPerMinute,
      timeout: config.timeout || strategy.connectionTimeout
    };
  }

  /**
   * Get retry configuration for a provider
   */
  getRetryConfig(providerName: string): RetryConfig {
    const strategy = this.getStrategy(providerName);

    return {
      maxAttempts: strategy.retryAttempts + 1, // +1 for initial attempt
      baseDelay: strategy.retryDelay,
      maxDelay: 60000, // 1 minute max delay
      backoffMultiplier: strategy.backoffMultiplier,
      jitter: true,
      retryCondition: strategy.customRetryCondition || this.defaultRetryCondition
    };
  }

  /**
   * Default retry condition
   */
  private defaultRetryCondition = (error: any): boolean => {
    // Retry on network errors, timeouts, and rate limits
    return (
      error?.code === 'ECONNRESET' ||
      error?.code === 'ENOTFOUND' ||
      error?.code === 'ETIMEDOUT' ||
      error?.code === 'ECONNREFUSED' ||
      error?.status >= 500 || // Server errors
      error?.status === 429 || // Rate limit
      error?.type === 'rate_limit_error' ||
      error?.type === 'timeout_error' ||
      error?.name === 'TimeoutError' ||
      error?.message?.includes('timeout') ||
      error?.message?.includes('rate limit')
    );
  };

  /**
   * Execute request with retry logic
   */
  async executeWithRetry<T>(
    providerName: string,
    operation: () => Promise<T>,
    context?: string
  ): Promise<T> {
    const retryConfig = this.getRetryConfig(providerName);
    let lastError: any;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;

        // Check if we should retry
        if (attempt === retryConfig.maxAttempts || !retryConfig.retryCondition(error)) {
          break;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(
          attempt,
          retryConfig.baseDelay,
          retryConfig.backoffMultiplier,
          retryConfig.maxDelay,
          retryConfig.jitter
        );

        console.log(
          `Retry attempt ${attempt}/${retryConfig.maxAttempts} for ${providerName}` +
          (context ? ` (${context})` : '') +
          ` after ${delay}ms. Error: ${error.message}`
        );

        // Wait before retry
        await this.sleep(delay);
      }
    }

    // All attempts failed, throw the last error
    throw lastError;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(
    attempt: number,
    baseDelay: number,
    multiplier: number,
    maxDelay: number,
    jitter: boolean
  ): number {
    let delay = baseDelay * Math.pow(multiplier, attempt - 1);

    // Cap the delay
    delay = Math.min(delay, maxDelay);

    // Add jitter to prevent thundering herd
    if (jitter) {
      const jitterAmount = delay * 0.1; // 10% jitter
      delay += Math.random() * jitterAmount - jitterAmount / 2;
    }

    return Math.floor(delay);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get all registered strategies
   */
  getAllStrategies(): Map<string, ProviderStrategy> {
    return new Map(this.strategies);
  }

  /**
   * Check if connection should be marked unhealthy based on error
   */
  shouldMarkConnectionUnhealthy(providerName: string, error: any): boolean {
    const strategy = this.getStrategy(providerName);

    // Mark unhealthy on authentication errors, forbidden access, or persistent failures
    return (
      error?.status === 401 || // Unauthorized
      error?.status === 403 || // Forbidden
      error?.status === 404 || // Not found (wrong endpoint)
      error?.code === 'ENOTFOUND' || // DNS resolution failed
      error?.code === 'ECONNREFUSED' || // Connection refused
      (error?.code === 'ECONNRESET' && error.retries > 2) // Too many connection resets
    );
  }

  /**
   * Get connection health check configuration
   */
  getHealthCheckConfig(providerName: string): {
    interval: number;
    timeout: number;
    maxFailures: number;
  } {
    const strategy = this.getStrategy(providerName);

    return {
      interval: strategy.healthCheckInterval,
      timeout: Math.min(strategy.connectionTimeout / 2, 10000),
      maxFailures: 3
    };
  }
}

// Global provider strategies instance
export const providerStrategies = new ProviderStrategies();