import { EventEmitter } from 'events';
import { getFailoverConfig, FailoverConfig } from '../config/failover.config';
import { createProviderLogger } from '../middleware/logging';
import { Redis } from 'ioredis';

export interface Provider {
  name: string;
  model?: string;
  connectionString?: string;
  weight: number;
  enabled: boolean;
  priority: number;
}

export interface ProviderHealth {
  healthy: boolean;
  lastCheck: number;
  consecutiveFailures: number;
  lastError?: string;
  latency: number;
  responseTime: number;
  availability: number;
}

export interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailureTime: number;
  nextAttempt: number;
}

export interface ProviderMetrics {
  name: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  lastRequestTime: number;
  uptime: number;
  errorRate: number;
  failoverCount: number;
}

export interface FailoverMetrics {
  totalFailovers: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  providerMetrics: Map<string, ProviderMetrics>;
  lastFailoverTime?: number;
  lastFailoverReason?: string;
}

export class ProviderFailover extends EventEmitter {
  private config: FailoverConfig;
  private providers: Map<string, Provider> = new Map();
  private providerHealth: Map<string, ProviderHealth> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private metrics: FailoverMetrics;
  private healthCheckTimer?: NodeJS.Timeout;
  private logger: any;
  private redis?: Redis;

  constructor(config: FailoverConfig, redis?: Redis) {
    super();
    this.config = config;
    this.redis = redis;
    this.logger = createProviderLogger('failover');

    // Initialize providers from config
    this.initializeProviders();

    // Initialize metrics
    this.metrics = {
      totalFailovers: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      providerMetrics: new Map()
    };

    // Start health checks if enabled
    if (this.config.healthCheck.enabled) {
      this.startHealthChecks();
    }

    this.logger.info('Provider failover system initialized', {
      enabled: this.config.enabled,
      primaryProvider: this.config.providers.primary,
      fallbackCount: this.config.providers.fallback.length,
      circuitBreakerEnabled: this.config.circuitBreaker.enabled
    });
  }

  private initializeProviders(): void {
    // Parse primary provider
    const primaryParts = this.config.providers.primary.split(',');
    if (primaryParts.length >= 2) {
      const [provider, model] = primaryParts;
      this.providers.set(this.config.providers.primary, {
        name: provider,
        model,
        weight: 1.0,
        enabled: true,
        priority: 1
      });
    }

    // Parse fallback providers
    this.config.providers.fallback.forEach((fallbackString, index) => {
      const parts = fallbackString.split(',');
      if (parts.length >= 2) {
        const [provider, model] = parts;
        this.providers.set(fallbackString, {
          name: provider,
          model,
          weight: 1.0,
          enabled: true,
          priority: 2 + index // Higher number = lower priority
        });
      }
    });

    // Initialize health for all providers
    for (const [key, provider] of this.providers) {
      this.providerHealth.set(key, {
        healthy: true, // Start optimistically
        lastCheck: Date.now(),
        consecutiveFailures: 0,
        latency: 0,
        responseTime: 0,
        availability: 100.0
      });

      // Initialize circuit breaker
      if (this.config.circuitBreaker.enabled) {
        this.circuitBreakers.set(key, {
          state: 'CLOSED',
          failureCount: 0,
          lastFailureTime: 0,
          nextAttempt: Date.now()
        });
      }

      // Initialize provider metrics
      this.metrics.providerMetrics.set(key, {
        name: provider.name,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatency: 0,
        lastRequestTime: 0,
        uptime: 100.0,
        errorRate: 0.0,
        failoverCount: 0
      });
    }
  }

  private parseProviderString(providerString: string): { provider: string; model: string } | null {
    const parts = providerString.split(',');
    if (parts.length >= 2) {
      const [provider, model] = parts;
      return { provider, model };
    }
    return null;
  }

  async executeRequest<T>(
    requestFn: (provider: string, model?: string) => Promise<T>,
    originalProviderString: string
  ): Promise<{ result: T; providerUsed: string; failover: boolean }> {
    if (!this.config.enabled) {
      const parsed = this.parseProviderString(originalProviderString);
      if (!parsed) {
        throw new Error(`Invalid provider format: ${originalProviderString}`);
      }
      return {
        result: await requestFn(parsed.provider, parsed.model),
        providerUsed: originalProviderString,
        failover: false
      };
    }

    const startTime = Date.now();
    this.metrics.totalRequests++;

    const providers = this.getProviderExecutionOrder(originalProviderString);
    let lastError: Error | null = null;
    let attempts = 0;

    for (const providerString of providers) {
      attempts++;

      try {
        // Check circuit breaker
        if (this.isCircuitBreakerOpen(providerString)) {
          this.logger.warn('Circuit breaker is open, skipping provider', {
            provider: providerString,
            state: this.circuitBreakers.get(providerString)?.state
          });
          continue;
        }

        // Check if provider is healthy
        const health = this.providerHealth.get(providerString);
        if (!health?.healthy) {
          this.logger.warn('Provider is unhealthy, skipping', {
            provider: providerString,
            consecutiveFailures: health?.consecutiveFailures
          });
          continue;
        }

        const parsed = this.parseProviderString(providerString);
        if (!parsed) {
          throw new Error(`Invalid provider format: ${providerString}`);
        }

        // Execute request
        this.logger.debug('Attempting request with provider', {
          provider: providerString,
          attempt: attempts,
          maxAttempts: providers.length
        });

        const result = await requestFn(parsed.provider, parsed.model);
        const duration = Date.now() - startTime;

        // Record success
        this.recordSuccess(providerString, duration);

        const wasFailover = providerString !== originalProviderString;
        if (wasFailover) {
          this.metrics.totalFailovers++;
          this.metrics.lastFailoverTime = Date.now();
          this.metrics.lastFailoverReason = lastError?.message;

          this.logger.info('Failover successful', {
            originalProvider: originalProviderString,
            failoverProvider: providerString,
            duration,
            attempts
          });

          this.emit('failover', {
            from: originalProviderString,
            to: providerString,
            reason: lastError?.message,
            duration
          });
        }

        return {
          result,
          providerUsed: providerString,
          failover: wasFailover
        };

      } catch (error) {
        lastError = error as Error;
        const duration = Date.now() - startTime;

        // Record failure
        this.recordFailure(providerString, error as Error, duration);

        this.logger.warn('Provider request failed', {
          provider: providerString,
          error: error instanceof Error ? error.message : String(error),
          attempt: attempts,
          maxAttempts: providers.length
        });

        // Don't retry if it's the last provider or if it's a non-retryable error
        if (attempts >= providers.length || !this.isRetryableError(error as Error)) {
          break;
        }

        // Wait before retry with exponential backoff
        const delay = Math.min(
          this.config.retryDelay * Math.pow(this.config.backoffMultiplier, attempts - 1),
          this.config.maxRetryDelay
        );
        await this.sleep(delay);
      }
    }

    // All providers failed
    this.metrics.failedRequests++;
    this.metrics.totalRequests--; // Subtract the initial increment

    const finalError = lastError || new Error('All providers failed');
    this.logger.error('All providers failed', finalError, {
      originalProvider: originalProviderString,
      attempts,
      duration: Date.now() - startTime
    });

    this.emit('allProvidersFailed', {
      originalProvider: originalProviderString,
      attempts,
      lastError: finalError
    });

    throw finalError;
  }

  private getProviderExecutionOrder(originalProvider: string): string[] {
    const providers: string[] = [];

    // Add original provider first if it's healthy and circuit breaker is closed
    const health = this.providerHealth.get(originalProvider);
    const circuitBreaker = this.circuitBreakers.get(originalProvider);

    if (health?.healthy &&
        (!circuitBreaker || circuitBreaker.state === 'CLOSED')) {
      providers.push(originalProvider);
    }

    // Add fallback providers in order of priority
    const fallbackProviders = Array.from(this.providers.entries())
      .filter(([key]) => key !== originalProvider)
      .sort(([, a], [, b]) => a.priority - b.priority)
      .map(([key]) => key);

    for (const fallback of fallbackProviders) {
      const health = this.providerHealth.get(fallback);
      const circuitBreaker = this.circuitBreakers.get(fallback);

      if (health?.healthy &&
          (!circuitBreaker || circuitBreaker.state === 'CLOSED')) {
        providers.push(fallback);
      }
    }

    // If no healthy providers, add all providers in priority order
    if (providers.length === 0) {
      providers.push(originalProvider);
      providers.push(...fallbackProviders);
    }

    return providers;
  }

  private isCircuitBreakerOpen(providerString: string): boolean {
    if (!this.config.circuitBreaker.enabled) {
      return false;
    }

    const breaker = this.circuitBreakers.get(providerString);
    if (!breaker) {
      return false;
    }

    if (breaker.state === 'OPEN') {
      // Check if recovery timeout has passed
      if (Date.now() >= breaker.nextAttempt) {
        breaker.state = 'HALF_OPEN';
        this.logger.info('Circuit breaker entering HALF_OPEN state', {
          provider: providerString
        });
        return false;
      }
      return true;
    }

    return false;
  }

  private isRetryableError(error: Error): boolean {
    const nonRetryablePatterns = [
      /authentication/i,
      /authorization/i,
      /invalid.*api.*key/i,
      /permission/i,
      /quota.*exceeded/i,
      /rate.*limit.*exceeded/i,
      /invalid.*request/i,
      /malformed/i
    ];

    const message = error.message.toLowerCase();
    return !nonRetryablePatterns.some(pattern => pattern.test(message));
  }

  private recordSuccess(providerString: string, duration: number): void {
    // Update metrics
    this.metrics.successfulRequests++;
    const providerMetrics = this.metrics.providerMetrics.get(providerString);
    if (providerMetrics) {
      providerMetrics.totalRequests++;
      providerMetrics.successfulRequests++;
      providerMetrics.lastRequestTime = Date.now();

      // Update average latency
      const totalLatency = providerMetrics.averageLatency * (providerMetrics.totalRequests - 1) + duration;
      providerMetrics.averageLatency = totalLatency / providerMetrics.totalRequests;

      // Update error rate
      providerMetrics.errorRate = providerMetrics.failedRequests / providerMetrics.totalRequests;
    }

    // Update health
    const health = this.providerHealth.get(providerString);
    if (health) {
      health.consecutiveFailures = 0;
      health.responseTime = duration;
      health.latency = duration;
      health.lastCheck = Date.now();
      health.healthy = true;
      health.availability = Math.min(100, health.availability + 5); // Gradual recovery
    }

    // Reset circuit breaker
    const breaker = this.circuitBreakers.get(providerString);
    if (breaker) {
      breaker.state = 'CLOSED';
      breaker.failureCount = 0;
    }

    // Cache in Redis if available
    if (this.redis) {
      this.cacheHealthInRedis(providerString).catch(error => {
        this.logger.warn('Failed to cache health in Redis', { error, provider: providerString });
      });
    }
  }

  private recordFailure(providerString: string, error: Error, duration: number): void {
    // Update metrics
    const providerMetrics = this.metrics.providerMetrics.get(providerString);
    if (providerMetrics) {
      providerMetrics.totalRequests++;
      providerMetrics.failedRequests++;
      providerMetrics.lastRequestTime = Date.now();

      // Update average latency
      const totalLatency = providerMetrics.averageLatency * (providerMetrics.totalRequests - 1) + duration;
      providerMetrics.averageLatency = totalLatency / providerMetrics.totalRequests;

      // Update error rate
      providerMetrics.errorRate = providerMetrics.failedRequests / providerMetrics.totalRequests;
    }

    // Update health
    const health = this.providerHealth.get(providerString);
    if (health) {
      health.consecutiveFailures++;
      health.lastError = error.message;
      health.lastCheck = Date.now();
      health.availability = Math.max(0, health.availability - 10); // Gradual degradation

      // Mark as unhealthy after consecutive failures
      if (health.consecutiveFailures >= 3) {
        health.healthy = false;
        this.logger.warn('Provider marked as unhealthy', {
          provider: providerString,
          consecutiveFailures: health.consecutiveFailures,
          lastError: error.message
        });
      }
    }

    // Update circuit breaker
    if (this.config.circuitBreaker.enabled) {
      const breaker = this.circuitBreakers.get(providerString);
      if (breaker) {
        breaker.failureCount++;
        breaker.lastFailureTime = Date.now();

        if (breaker.state === 'HALF_OPEN' ||
            breaker.failureCount >= this.config.circuitBreaker.failureThreshold) {
          breaker.state = 'OPEN';
          breaker.nextAttempt = Date.now() + this.config.circuitBreaker.recoveryTimeout;

          this.logger.warn('Circuit breaker opened', {
            provider: providerString,
            failureCount: breaker.failureCount,
            threshold: this.config.circuitBreaker.failureThreshold
          });

          this.emit('circuitBreakerOpened', {
            provider: providerString,
            failureCount: breaker.failureCount
          });
        }
      }
    }
  }

  private async startHealthChecks(): void {
    const checkHealth = async () => {
      for (const [providerString, provider] of this.providers) {
        try {
          await this.performHealthCheck(providerString);
        } catch (error) {
          this.logger.warn('Health check failed', {
            provider: providerString,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    };

    // Run immediately
    await checkHealth();

    // Schedule periodic checks
    this.healthCheckTimer = setInterval(checkHealth, this.config.healthCheckInterval);
  }

  private async performHealthCheck(providerString: string): Promise<void> {
    const parsed = this.parseProviderString(providerString);
    if (!parsed) {
      return;
    }

    const startTime = Date.now();

    try {
      // For now, just simulate health check with a timeout
      // In a real implementation, you would make an actual request to the provider
      await this.withTimeout(this.sleep(100), this.config.healthCheck.timeout);

      const duration = Date.now() - startTime;
      const health = this.providerHealth.get(providerString);

      if (health) {
        health.lastCheck = Date.now();
        health.responseTime = duration;
        health.latency = duration;

        // Mark as healthy if previously unhealthy
        if (!health.healthy && health.consecutiveFailures < 3) {
          health.healthy = true;
          this.logger.info('Provider recovered', {
            provider: providerString,
            responseTime: duration
          });

          this.emit('providerRecovered', {
            provider: providerString,
            responseTime: duration
          });
        }
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordFailure(providerString, error instanceof Error ? error : new Error(String(error)), duration);
    }
  }

  private async cacheHealthInRedis(providerString: string): Promise<void> {
    if (!this.redis) return;

    const health = this.providerHealth.get(providerString);
    if (!health) return;

    const key = `failover:health:${providerString}`;
    await this.redis.setex(key, 300, JSON.stringify({
      healthy: health.healthy,
      lastCheck: health.lastCheck,
      consecutiveFailures: health.consecutiveFailures,
      latency: health.latency,
      responseTime: health.responseTime,
      availability: health.availability
    }));
  }

  private async loadHealthFromRedis(providerString: string): Promise<void> {
    if (!this.redis) return;

    try {
      const key = `failover:health:${providerString}`;
      const cached = await this.redis.get(key);

      if (cached) {
        const healthData = JSON.parse(cached);
        this.providerHealth.set(providerString, healthData);
      }
    } catch (error) {
      this.logger.warn('Failed to load health from Redis', { error, provider: providerString });
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), timeoutMs);
      })
    ]);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public API methods

  getMetrics(): FailoverMetrics {
    return {
      ...this.metrics,
      providerMetrics: new Map(this.metrics.providerMetrics)
    };
  }

  getProviderHealth(): Map<string, ProviderHealth> {
    return new Map(this.providerHealth);
  }

  getCircuitBreakerStatus(): Map<string, CircuitBreakerState> {
    return new Map(this.circuitBreakers);
  }

  async forceFailover(fromProvider: string, toProvider?: string): Promise<boolean> {
    const fromHealth = this.providerHealth.get(fromProvider);
    if (fromHealth) {
      fromHealth.healthy = false;
      fromHealth.consecutiveFailures = 10; // Force unhealthy state
    }

    this.logger.info('Manual failover triggered', {
      fromProvider,
      toProvider,
      reason: 'manual'
    });

    this.emit('manualFailover', {
      from: fromProvider,
      to: toProvider,
      reason: 'manual'
    });

    return true;
  }

  async recoverProvider(providerString: string): Promise<boolean> {
    const health = this.providerHealth.get(providerString);
    if (health) {
      health.healthy = true;
      health.consecutiveFailures = 0;
      health.lastError = undefined;
      health.availability = 100;
    }

    const breaker = this.circuitBreakers.get(providerString);
    if (breaker) {
      breaker.state = 'CLOSED';
      breaker.failureCount = 0;
    }

    this.logger.info('Provider manually recovered', {
      provider: providerString
    });

    this.emit('providerRecovered', {
      provider: providerString,
      reason: 'manual'
    });

    return true;
  }

  updateConfig(newConfig: Partial<FailoverConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Failover config updated', { config: this.config });
  }

  getConfig(): FailoverConfig {
    return { ...this.config };
  }

  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    this.removeAllListeners();
  }
}

export function createProviderFailover(config: FailoverConfig, redis?: Redis): ProviderFailover {
  return new ProviderFailover(config, redis);
}