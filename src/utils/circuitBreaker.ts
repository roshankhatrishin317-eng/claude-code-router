/**
 * Circuit Breaker Pattern for Provider Fault Tolerance
 *
 * This module implements a circuit breaker pattern to prevent cascading failures
 * and provide fault tolerance for LLM provider calls.
 */

import { EventEmitter } from 'events';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;        // Number of failures to open circuit
  successThreshold: number;        // Number of successes to close circuit from half-open
  timeout: number;                 // Time to wait before trying half-open (ms)
  monitoringPeriod: number;        // Time window for failure counting (ms)
  resetTimeout: number;            // How long to stay open before attempting reset (ms)
}

export interface CircuitBreakerMetrics {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  totalRequests: number;
  failureRate: number;
  averageResponseTime: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  nextAttemptTime?: number;
}

export interface CircuitBreakerEvent {
  provider: string;
  model?: string;
  state: CircuitBreakerState;
  timestamp: number;
  reason?: string;
}

export class ProviderCircuitBreaker extends EventEmitter {
  private state: CircuitBreakerState = 'CLOSED';
  private failures: number = 0;
  private successes: number = 0;
  private totalRequests: number = 0;
  private failureTimestamps: number[] = [];
  private successTimestamps: number[] = [];
  private responseTimes: number[] = [];
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private nextAttemptTime?: number;

  private config: CircuitBreakerConfig;

  constructor(
    private provider: string,
    private model?: string,
    customConfig?: Partial<CircuitBreakerConfig>
  ) {
    super();

    this.config = {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 60000, // 1 minute
      monitoringPeriod: 300000, // 5 minutes
      resetTimeout: 300000, // 5 minutes
      ...customConfig
    };
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
        this.successes = 0; // Reset success counter for half-open state
        this.emitCircuitBreakerEvent('HALF_OPEN', 'Attempting reset');
      } else {
        throw new Error(
          `Circuit breaker is OPEN for ${this.provider}${this.model ? `/${this.model}` : ''}. ` +
          `Next attempt at ${new Date(this.nextAttemptTime!).toISOString()}`
        );
      }
    }

    const startTime = Date.now();
    this.totalRequests++;

    try {
      const result = await operation();
      const responseTime = Date.now() - startTime;

      this.onSuccess(responseTime);
      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.onFailure(responseTime, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(responseTime: number): void {
    this.successes++;
    this.lastSuccessTime = Date.now();
    this.successTimestamps.push(this.lastSuccessTime);
    this.responseTimes.push(responseTime);

    // Clean old timestamps
    this.cleanOldTimestamps();

    if (this.state === 'HALF_OPEN') {
      if (this.successes >= this.config.successThreshold) {
        this.state = 'CLOSED';
        this.failures = 0;
        this.emitCircuitBreakerEvent('CLOSED', 'Circuit recovered');
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure counter on success in closed state
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(responseTime: number, errorMessage: string): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    this.failureTimestamps.push(this.lastFailureTime);
    this.responseTimes.push(responseTime);

    // Clean old timestamps
    this.cleanOldTimestamps();

    // Check if we should open the circuit
    if (this.state === 'CLOSED' || this.state === 'HALF_OPEN') {
      const recentFailures = this.getRecentFailures();
      if (recentFailures >= this.config.failureThreshold) {
        this.state = 'OPEN';
        this.nextAttemptTime = Date.now() + this.config.resetTimeout;
        this.emitCircuitBreakerEvent(
          'OPEN',
          `Failure threshold exceeded: ${recentFailures} failures in ${this.config.monitoringPeriod}ms`
        );
      }
    }
  }

  /**
   * Check if circuit breaker should attempt reset
   */
  private shouldAttemptReset(): boolean {
    return this.nextAttemptTime !== undefined && Date.now() >= this.nextAttemptTime;
  }

  /**
   * Get number of recent failures
   */
  private getRecentFailures(): number {
    const cutoffTime = Date.now() - this.config.monitoringPeriod;
    return this.failureTimestamps.filter(timestamp => timestamp > cutoffTime).length;
  }

  /**
   * Clean old timestamps
   */
  private cleanOldTimestamps(): void {
    const cutoffTime = Date.now() - this.config.monitoringPeriod;

    this.failureTimestamps = this.failureTimestamps.filter(t => t > cutoffTime);
    this.successTimestamps = this.successTimestamps.filter(t => t > cutoffTime);

    // Keep only last 100 response times for memory efficiency
    if (this.responseTimes.length > 100) {
      this.responseTimes = this.responseTimes.slice(-100);
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    const recentFailures = this.getRecentFailures();
    const recentSuccesses = this.successTimestamps.filter(t => t > Date.now() - this.config.monitoringPeriod).length;
    const totalRecent = recentFailures + recentSuccesses;

    const averageResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length
      : 0;

    const failureRate = totalRecent > 0 ? (recentFailures / totalRecent) * 100 : 0;

    return {
      state: this.state,
      failures: recentFailures,
      successes: recentSuccesses,
      totalRequests: this.totalRequests,
      failureRate,
      averageResponseTime,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime
    };
  }

  /**
   * Get circuit breaker status
   */
  getStatus(): {
    provider: string;
    model?: string;
    state: CircuitBreakerState;
    isHealthy: boolean;
    nextAttemptTime?: number;
    metrics: CircuitBreakerMetrics;
  } {
    const metrics = this.getMetrics();
    const isHealthy = this.state === 'CLOSED' || this.state === 'HALF_OPEN';

    return {
      provider: this.provider,
      model: this.model,
      state: this.state,
      isHealthy,
      nextAttemptTime: this.nextAttemptTime,
      metrics
    };
  }

  /**
   * Reset circuit breaker manually
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.failureTimestamps = [];
    this.successTimestamps = [];
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.nextAttemptTime = undefined;

    this.emitCircuitBreakerEvent('CLOSED', 'Manually reset');
  }

  /**
   * Force circuit breaker to open
   */
  forceOpen(): void {
    this.state = 'OPEN';
    this.nextAttemptTime = Date.now() + this.config.resetTimeout;
    this.emitCircuitBreakerEvent('OPEN', 'Manually forced open');
  }

  /**
   * Emit circuit breaker event
   */
  private emitCircuitBreakerEvent(state: CircuitBreakerState, reason: string): void {
    const event: CircuitBreakerEvent = {
      provider: this.provider,
      model: this.model,
      state,
      timestamp: Date.now(),
      reason
    };

    this.emit('stateChanged', event);
    console.log(`Circuit Breaker [${this.provider}${this.model ? `/${this.model}` : ''}] changed to ${state}: ${reason}`);
  }

  /**
   * Get health status summary
   */
  getHealthSummary(): {
    healthy: boolean;
    status: string;
    issues: string[];
  } {
    const metrics = this.getMetrics();
    const issues: string[] = [];

    if (this.state === 'OPEN') {
      issues.push(`Circuit breaker is OPEN - provider unavailable`);
      if (this.nextAttemptTime) {
        issues.push(`Next retry at ${new Date(this.nextAttemptTime).toISOString()}`);
      }
    } else if (this.state === 'HALF_OPEN') {
      issues.push(`Circuit breaker is HALF_OPEN - testing provider recovery`);
    }

    if (metrics.failureRate > 50) {
      issues.push(`High failure rate: ${metrics.failureRate.toFixed(1)}%`);
    }

    if (metrics.averageResponseTime > 10000) {
      issues.push(`Slow response time: ${metrics.averageResponseTime.toFixed(0)}ms`);
    }

    const healthy = this.state === 'CLOSED' && metrics.failureRate < 10;

    return {
      healthy,
      status: this.state,
      issues
    };
  }
}

export class CircuitBreakerManager {
  private breakers: Map<string, ProviderCircuitBreaker> = new Map();

  /**
   * Get or create circuit breaker for provider/model
   */
  getCircuitBreaker(provider: string, model?: string, config?: Partial<CircuitBreakerConfig>): ProviderCircuitBreaker {
    const key = model ? `${provider}:${model}` : provider;

    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new ProviderCircuitBreaker(provider, model, config);

      // Listen to state changes and log them
      breaker.on('stateChanged', (event) => {
        console.log(`Circuit Breaker Event: [${event.provider}${event.model ? `/${event.model}` : ''}] ${event.state} - ${event.reason}`);
      });

      this.breakers.set(key, breaker);
    }

    return breaker;
  }

  /**
   * Get all circuit breaker statuses
   */
  getAllStatuses(): Array<{
    provider: string;
    model?: string;
    state: CircuitBreakerState;
    isHealthy: boolean;
    metrics: CircuitBreakerMetrics;
  }> {
    return Array.from(this.breakers.values()).map(breaker => breaker.getStatus());
  }

  /**
   * Get health summary for all providers
   */
  getHealthSummary(): {
    total: number;
    healthy: number;
    unhealthy: number;
    byState: Record<CircuitBreakerState, number>;
    providers: Array<{
      provider: string;
      model?: string;
      healthy: boolean;
      status: string;
      issues: string[];
    }>;
  } {
    const statuses = this.getAllStatuses();
    const byState: Record<CircuitBreakerState, number> = {
      'CLOSED': 0,
      'OPEN': 0,
      'HALF_OPEN': 0
    };

    statuses.forEach(status => {
      byState[status.state]++;
    });

    return {
      total: statuses.length,
      healthy: statuses.filter(s => s.isHealthy).length,
      unhealthy: statuses.filter(s => !s.isHealthy).length,
      byState,
      providers: statuses.map(status => {
        const breaker = this.breakers.get(status.model ? `${status.provider}:${status.model}` : status.provider)!;
        const summary = breaker.getHealthSummary();

        return {
          provider: status.provider,
          model: status.model,
          healthy: summary.healthy,
          status: summary.status,
          issues: summary.issues
        };
      })
    };
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.breakers.forEach(breaker => breaker.reset());
    console.log('All circuit breakers reset');
  }

  /**
   * Get circuit breaker for execution
   */
  async executeWithCircuitBreaker<T>(
    provider: string,
    model: string | undefined,
    operation: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>
  ): Promise<T> {
    const breaker = this.getCircuitBreaker(provider, model, config);
    return breaker.execute(operation);
  }
}

// Singleton instance
export const circuitBreakerManager = new CircuitBreakerManager();

// Log circuit breaker events
circuitBreakerManager['breakers']; // Access private property for type

// Periodic health check and cleanup
setInterval(() => {
  const summary = circuitBreakerManager.getHealthSummary();
  if (summary.unhealthy > 0) {
    console.log(`Circuit Breaker Health Check: ${summary.healthy}/${summary.total} providers healthy`);
  }
}, 60000); // Every minute
