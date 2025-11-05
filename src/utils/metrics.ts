import { EventEmitter } from 'node:events';
import { realTimeTokenTracker } from './realTimeTokenTracker';
import { systemHealthMonitor } from './systemHealth';
import { metricsDatabase } from './metricsDatabase';

export interface RequestMetrics {
  timestamp: number;
  sessionId?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  duration: number;
  success: boolean;
  errorType?: string;
  statusCode?: number;
  ipAddress?: string;
  userAgent?: string;
  firstTokenLatency?: number;
  streamingEfficiency?: number;
}

export interface LatencyPercentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  average: number;
  min: number;
  max: number;
}

export interface StatusCodeDistribution {
  '2xx_success': number;
  '3xx_redirect': number;
  '4xx_client_error': number;
  '5xx_server_error': number;
  errorTypes: {
    '400_bad_request': number;
    '401_unauthorized': number;
    '403_forbidden': number;
    '429_rate_limited': number;
    '500_server_error': number;
    '502_bad_gateway': number;
    '503_unavailable': number;
  };
}

export interface SystemHealthSummary {
  status: 'healthy' | 'warning' | 'critical';
  cpuUsage: number;
  memoryUsage: number;
  heapUsage: number;
  eventLoopDelay: number;
  score: number;
  issues: string[];
}

export interface RealTimeMetrics {
  requestsPerMinute: number;
  tokensPerSecond: number;
  inputTPS: number;
  outputTPS: number;
  activeSessions: number;
  totalRequests: number;
  errorRate: number;
  averageLatency: number;
  latencyPercentiles: LatencyPercentiles;
  inputTokensPerMinute: number;
  outputTokensPerMinute: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  statusCodeDistribution: StatusCodeDistribution;
  systemHealth: SystemHealthSummary;
}

export interface TokenCosts {
  inputCostPer1K: number;
  outputCostPer1K: number;
}

export interface ProviderMetrics {
  provider: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
  averageLatency: number;
  totalCost: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  tokensPerRequest: number;
}

export interface TokenAnalytics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  averageTokensPerRequest: number;
  inputToOutputRatio: number;
  topModelsByTokens: Array<{
    model: string;
    provider: string;
    tokens: number;
    cost: number;
  }>;
  hourlyTokenUsage: Array<{
    hour: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }>;
}

export interface SessionMetrics {
  sessionId: string;
  startTime: number;
  lastActivity: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}

export class MetricsCollector extends EventEmitter {
  private requestHistory: RequestMetrics[] = [];
  private activeSessions: Map<string, SessionMetrics> = new Map();
  private providerMetrics: Map<string, ProviderMetrics> = new Map();
  private lastMinuteRequests: RequestMetrics[] = [];
  private lastSecondTokens: { tokens: number; inputTokens: number; outputTokens: number; timestamp: number }[] = [];
  private pendingPersists: RequestMetrics[] = [];
  private readonly MAX_HISTORY_SIZE = 10000;
  private readonly ONE_MINUTE = 60 * 1000;
  private readonly ONE_SECOND = 1000;
  private readonly BATCH_SIZE = 100;
  private readonly BATCH_TIMEOUT = 5000; // 5 seconds
  private cleanupInterval?: NodeJS.Timeout;
  private batchFlushInterval?: NodeJS.Timeout;
  private dbCleanupInterval?: NodeJS.Timeout;

  // Default token costs (can be overridden per provider/model)
  private tokenCosts: Map<string, TokenCosts> = new Map([
    ['anthropic:claude-3-opus', { inputCostPer1K: 0.015, outputCostPer1K: 0.075 }],
    ['anthropic:claude-3-sonnet', { inputCostPer1K: 0.003, outputCostPer1K: 0.015 }],
    ['anthropic:claude-3-haiku', { inputCostPer1K: 0.00025, outputCostPer1K: 0.00125 }],
    ['anthropic:claude-3-5-sonnet', { inputCostPer1K: 0.003, outputCostPer1K: 0.015 }],
    ['openai:gpt-4', { inputCostPer1K: 0.03, outputCostPer1K: 0.06 }],
    ['openai:gpt-4-turbo', { inputCostPer1K: 0.01, outputCostPer1K: 0.03 }],
    ['openai:gpt-4o', { inputCostPer1K: 0.005, outputCostPer1K: 0.015 }],
    ['openai:gpt-4o-mini', { inputCostPer1K: 0.00015, outputCostPer1K: 0.0006 }],
    ['openai:gpt-3.5-turbo', { inputCostPer1K: 0.001, outputCostPer1K: 0.002 }],
    ['google:gemini-1.5-pro', { inputCostPer1K: 0.0035, outputCostPer1K: 0.0105 }],
    ['google:gemini-1.5-flash', { inputCostPer1K: 0.00015, outputCostPer1K: 0.0006 }],
    ['deepseek:deepseek-chat', { inputCostPer1K: 0.00014, outputCostPer1K: 0.00028 }],
    ['deepseek:deepseek-coder', { inputCostPer1K: 0.00014, outputCostPer1K: 0.00028 }],
    ['groq:llama-3.1-405b', { inputCostPer1K: 0.00089, outputCostPer1K: 0.00089 }],
    ['groq:llama-3.1-70b', { inputCostPer1K: 0.00059, outputCostPer1K: 0.00079 }],
    ['openrouter:openai/gpt-4o', { inputCostPer1K: 0.005, outputCostPer1K: 0.015 }],
    ['openrouter:anthropic/claude-3.5-sonnet', { inputCostPer1K: 0.003, outputCostPer1K: 0.015 }],
  ]);

  constructor() {
    super();
    // Clean up old data every minute
    this.cleanupInterval = setInterval(() => this.cleanupOldData(), 60 * 1000);

    // Start batch persistence
    this.batchFlushInterval = setInterval(() => this.flushBatch(), this.BATCH_TIMEOUT);

    // Cleanup database every hour
    this.dbCleanupInterval = setInterval(() => {
      metricsDatabase.cleanupOldData(90); // Keep 90 days of data
    }, 60 * 60 * 1000);
  }

  // Method to update token costs for custom providers/models
  setTokenCosts(provider: string, model: string, costs: TokenCosts): void {
    const key = `${provider}:${model}`;
    this.tokenCosts.set(key, costs);
  }

  private calculateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
    const key = `${provider}:${model}`;
    const costs = this.tokenCosts.get(key);

    if (!costs) {
      // Default cost calculation if not configured
      return (inputTokens * 0.001 + outputTokens * 0.002) / 1000; // Default rates
    }

    const inputCost = (inputTokens / 1000) * costs.inputCostPer1K;
    const outputCost = (outputTokens / 1000) * costs.outputCostPer1K;
    return inputCost + outputCost;
  }

  recordRequest(metrics: RequestMetrics): void {
    try {
      // Validate metrics data
      if (!metrics || !metrics.timestamp || !metrics.provider || !metrics.model) {
        console.warn('[METRICS] Invalid metrics data, skipping:', metrics);
        return;
      }

      // Add to history
      this.requestHistory.push(metrics);
      if (this.requestHistory.length > this.MAX_HISTORY_SIZE) {
        this.requestHistory.shift();
      }

      // Update last minute requests
      this.lastMinuteRequests.push(metrics);

      // Update session metrics
      this.updateSessionMetrics(metrics);

      // Update provider metrics
      this.updateProviderMetrics(metrics);

      // Update token rate tracking
      const totalTokens = metrics.inputTokens + metrics.outputTokens;
      this.lastSecondTokens.push({
        tokens: totalTokens,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        timestamp: metrics.timestamp
      });

      // Update real-time token tracker
      if (metrics.inputTokens > 0 || metrics.outputTokens > 0) {
        realTimeTokenTracker.addTokenData(
          metrics.sessionId || 'unknown',
          metrics.inputTokens,
          metrics.outputTokens
        );
      }

      // Add to batch for persistence
      this.pendingPersists.push(metrics);

      // Flush batch if it's full
      if (this.pendingPersists.length >= this.BATCH_SIZE) {
        this.flushBatch();
      }

      // Emit event for real-time updates
      this.emit('metricsUpdated', this.getRealTimeMetrics());
    } catch (error) {
      console.error('[METRICS] Error recording request metrics:', error);
    }
  }

  /**
   * Flush pending metrics to database
   */
  private flushBatch(): void {
    if (this.pendingPersists.length === 0) return;

    const batchToFlush = [...this.pendingPersists];
    this.pendingPersists = [];

    try {
      metricsDatabase.insertRequestsBatch(batchToFlush);
      console.log(`[METRICS] Successfully flushed ${batchToFlush.length} metrics to database`);
    } catch (error) {
      console.error('Error persisting metrics to database:', error);
      // Re-add failed metrics for retry (keep only last batch to prevent memory leak)
      this.pendingPersists = batchToFlush.slice(-this.BATCH_SIZE);
    }
  }

  private updateSessionMetrics(metrics: RequestMetrics): void {
    if (!metrics.sessionId) return;

    let session = this.activeSessions.get(metrics.sessionId);
    if (!session) {
      session = {
        sessionId: metrics.sessionId,
        startTime: metrics.timestamp,
        lastActivity: metrics.timestamp,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        provider: metrics.provider,
        model: metrics.model
      };
      this.activeSessions.set(metrics.sessionId, session);
    }

    session.requestCount++;
    session.inputTokens += metrics.inputTokens;
    session.outputTokens += metrics.outputTokens;
    session.lastActivity = metrics.timestamp;
    session.provider = metrics.provider;
    session.model = metrics.model;
  }

  private updateProviderMetrics(metrics: RequestMetrics): void {
    const key = `${metrics.provider}:${metrics.model}`;
    let provider = this.providerMetrics.get(key);

    if (!provider) {
      provider = {
        provider: metrics.provider,
        model: metrics.model,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        errors: 0,
        averageLatency: 0,
        totalCost: 0,
        averageInputTokens: 0,
        averageOutputTokens: 0,
        tokensPerRequest: 0
      };
      this.providerMetrics.set(key, provider);
    }

    provider.requests++;
    provider.inputTokens += metrics.inputTokens;
    provider.outputTokens += metrics.outputTokens;

    // Calculate and add cost
    const requestCost = this.calculateCost(metrics.provider, metrics.model, metrics.inputTokens, metrics.outputTokens);
    provider.totalCost += requestCost;

    if (!metrics.success) {
      provider.errors++;
    }

    // Update average latency
    const totalLatency = provider.averageLatency * (provider.requests - 1) + metrics.duration;
    provider.averageLatency = totalLatency / provider.requests;

    // Update token averages
    provider.averageInputTokens = provider.inputTokens / provider.requests;
    provider.averageOutputTokens = provider.outputTokens / provider.requests;
    provider.tokensPerRequest = (provider.inputTokens + provider.outputTokens) / provider.requests;
  }

  private cleanupOldData(): void {
    const now = Date.now();

    // Clean requests older than 1 minute
    this.lastMinuteRequests = this.lastMinuteRequests.filter(
      req => now - req.timestamp < this.ONE_MINUTE
    );

    // Clean token data older than 1 second
    this.lastSecondTokens = this.lastSecondTokens.filter(
      data => now - data.timestamp < this.ONE_SECOND
    );

    // Clean inactive sessions (no activity for 5 minutes)
    const FIVE_MINUTES = 5 * 60 * 1000;
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (now - session.lastActivity > FIVE_MINUTES) {
        this.activeSessions.delete(sessionId);
      }
    }

    this.emit('metricsUpdated', this.getRealTimeMetrics());
  }

  getRealTimeMetrics(): RealTimeMetrics {
    const now = Date.now();

    // Calculate RPM (requests per minute)
    const rpm = this.lastMinuteRequests.length;

    // Calculate TPS (tokens per second)
    const recentTokens = this.lastSecondTokens.reduce(
      (sum, data) => sum + data.tokens, 0
    );
    const tps = recentTokens;

    // Advanced real-time TPS calculation with high precision
    const realTimeTPS = realTimeTokenTracker.getTPS();
    const inputTokensInLastSecond = realTimeTPS.inputTPS;
    const outputTokensInLastSecond = realTimeTPS.outputTPS;

    // Calculate input/output tokens per minute
    const inputTokensPerMinute = this.lastMinuteRequests.reduce(
      (sum, req) => sum + req.inputTokens, 0
    );
    const outputTokensPerMinute = this.lastMinuteRequests.reduce(
      (sum, req) => sum + req.outputTokens, 0
    );

    // Calculate total tokens
    const totalInputTokens = this.requestHistory.reduce(
      (sum, req) => sum + req.inputTokens, 0
    );
    const totalOutputTokens = this.requestHistory.reduce(
      (sum, req) => sum + req.outputTokens, 0
    );

    // Calculate error rate
    const recentErrors = this.lastMinuteRequests.filter(req => !req.success).length;
    const errorRate = this.lastMinuteRequests.length > 0
      ? (recentErrors / this.lastMinuteRequests.length) * 100
      : 0;

    // Calculate latency percentiles
    const latencyPercentiles = this.calculateLatencyPercentiles(this.lastMinuteRequests.map(req => req.duration));

    // Calculate status code distribution
    const statusCodeDistribution = this.calculateStatusCodeDistribution(this.lastMinuteRequests);

    // Get system health summary
    const systemHealth = systemHealthMonitor.getHealthStatus();

    // Calculate average latency
    const averageLatency = latencyPercentiles.average;

    return {
      requestsPerMinute: rpm,
      tokensPerSecond: tps,
      inputTPS: inputTokensInLastSecond,
      outputTPS: outputTokensInLastSecond,
      activeSessions: this.activeSessions.size,
      totalRequests: this.requestHistory.length,
      errorRate: Math.round(errorRate * 100) / 100,
      averageLatency: Math.round(averageLatency),
      latencyPercentiles,
      inputTokensPerMinute,
      outputTokensPerMinute,
      totalInputTokens,
      totalOutputTokens,
      statusCodeDistribution,
      systemHealth
    };
  }

  getProviderMetrics(): ProviderMetrics[] {
    return Array.from(this.providerMetrics.values());
  }

  getSessionMetrics(): SessionMetrics[] {
    return Array.from(this.activeSessions.values());
  }

  getHistoricalRequests(limit: number = 100): RequestMetrics[] {
    return this.requestHistory.slice(-limit);
  }

  getTokenAnalytics(): TokenAnalytics {
    const totalInputTokens = this.requestHistory.reduce(
      (sum, req) => sum + req.inputTokens, 0
    );
    const totalOutputTokens = this.requestHistory.reduce(
      (sum, req) => sum + req.outputTokens, 0
    );
    const totalTokens = totalInputTokens + totalOutputTokens;

    // Calculate total cost
    const totalCost = this.requestHistory.reduce(
      (sum, req) => sum + this.calculateCost(req.provider, req.model, req.inputTokens, req.outputTokens), 0
    );

    // Calculate average tokens per request
    const averageTokensPerRequest = this.requestHistory.length > 0
      ? totalTokens / this.requestHistory.length
      : 0;

    // Calculate input to output ratio
    const inputToOutputRatio = totalInputTokens > 0
      ? totalOutputTokens / totalInputTokens
      : 0;

    // Get top models by tokens
    const modelTokenMap = new Map<string, { tokens: number; cost: number; provider: string }>();
    this.requestHistory.forEach(req => {
      const key = `${req.provider}:${req.model}`;
      const existing = modelTokenMap.get(key) || { tokens: 0, cost: 0, provider: req.provider };
      const requestTokens = req.inputTokens + req.outputTokens;
      const requestCost = this.calculateCost(req.provider, req.model, req.inputTokens, req.outputTokens);

      modelTokenMap.set(key, {
        tokens: existing.tokens + requestTokens,
        cost: existing.cost + requestCost,
        provider: req.provider
      });
    });

    const topModelsByTokens = Array.from(modelTokenMap.entries())
      .map(([model, data]) => ({
        model: model.split(':')[1],
        provider: data.provider,
        tokens: data.tokens,
        cost: data.cost
      }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10);

    // Calculate hourly token usage (last 24 hours)
    const hourlyUsage = new Map<string, { inputTokens: number; outputTokens: number; cost: number }>();
    const now = Date.now();
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

    this.requestHistory
      .filter(req => req.timestamp >= twentyFourHoursAgo)
      .forEach(req => {
        const hour = new Date(req.timestamp).toLocaleString('en-US', {
          hour: '2-digit',
          hour12: false
        });
        const existing = hourlyUsage.get(hour) || { inputTokens: 0, outputTokens: 0, cost: 0 };
        const requestCost = this.calculateCost(req.provider, req.model, req.inputTokens, req.outputTokens);

        hourlyUsage.set(hour, {
          inputTokens: existing.inputTokens + req.inputTokens,
          outputTokens: existing.outputTokens + req.outputTokens,
          cost: existing.cost + requestCost
        });
      });

    const hourlyTokenUsage = Array.from(hourlyUsage.entries())
      .map(([hour, data]) => ({ hour, ...data }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalCost,
      averageTokensPerRequest,
      inputToOutputRatio,
      topModelsByTokens,
      hourlyTokenUsage
    };
  }

  getMetricsSummary() {
    const realTime = this.getRealTimeMetrics();
    const providers = this.getProviderMetrics();
    const sessions = this.getSessionMetrics();
    const tokenAnalytics = this.getTokenAnalytics();

    // Calculate total tokens
    const totalTokens = providers.reduce(
      (sum, p) => sum + p.inputTokens + p.outputTokens, 0
    );

    // Get top providers by requests
    const topProviders = providers
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 5);

    return {
      realTime,
      totalTokens,
      totalCost: tokenAnalytics.totalCost,
      providerCount: providers.length,
      topProviders,
      activeSessions: sessions.length,
      uptime: process.uptime(),
      tokenAnalytics
    };
  }

  /**
   * Get historical analytics from database
   */
  getHistoricalAnalytics(query: {
    startTime?: number;
    endTime?: number;
    provider?: string;
    model?: string;
    hours?: number;
  }) {
    const historicalQuery = {
      startTime: query.startTime || (Date.now() - (query.hours || 24) * 60 * 60 * 1000),
      endTime: query.endTime,
      provider: query.provider,
      model: query.model,
      limit: 100
    };

    return metricsDatabase.queryHistoricalMetrics(historicalQuery);
  }

  /**
   * Get database statistics
   */
  getDatabaseStats() {
    return metricsDatabase.getDatabaseStats();
  }

  /**
   * Get cost analytics
   */
  getCostAnalytics(days: number = 30) {
    return metricsDatabase.getCostAnalytics(days);
  }

  /**
   * Get top models from database
   */
  getTopModels(limit: number = 10) {
    return metricsDatabase.getTopModels(limit);
  }

  /**
   * Force flush any pending data to database
   */
  flushAllData(): void {
    this.flushBatch();
    console.log('All metrics data flushed to database');
  }

  /**
   * Calculate latency percentiles using quickselect algorithm
   */
  private calculateLatencyPercentiles(latencies: number[]): LatencyPercentiles {
    if (latencies.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0, p999: 0, average: 0, min: 0, max: 0 };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const n = sorted.length;

    const average = sorted.reduce((sum, val) => sum + val, 0) / n;
    const min = sorted[0];
    const max = sorted[n - 1];

    // Helper function to get percentile
    const percentile = (arr: number[], p: number): number => {
      if (arr.length === 0) return 0;
      const index = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, Math.min(index, arr.length - 1))];
    };

    return {
      p50: Math.round(percentile(sorted, 50)),
      p90: Math.round(percentile(sorted, 90)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      p999: Math.round(percentile(sorted, 99.9)),
      average: Math.round(average),
      min: Math.round(min),
      max: Math.round(max)
    };
  }

  /**
   * Calculate status code distribution
   */
  private calculateStatusCodeDistribution(requests: RequestMetrics[]): StatusCodeDistribution {
    const distribution: StatusCodeDistribution = {
      '2xx_success': 0,
      '3xx_redirect': 0,
      '4xx_client_error': 0,
      '5xx_server_error': 0,
      errorTypes: {
        '400_bad_request': 0,
        '401_unauthorized': 0,
        '403_forbidden': 0,
        '429_rate_limited': 0,
        '500_server_error': 0,
        '502_bad_gateway': 0,
        '503_unavailable': 0
      }
    };

    for (const req of requests) {
      const statusCode = req.statusCode || (req.success ? 200 : 500);

      if (statusCode >= 200 && statusCode < 300) {
        distribution['2xx_success']++;
      } else if (statusCode >= 300 && statusCode < 400) {
        distribution['3xx_redirect']++;
      } else if (statusCode >= 400 && statusCode < 500) {
        distribution['4xx_client_error']++;
        switch (statusCode) {
          case 400: distribution.errorTypes['400_bad_request']++; break;
          case 401: distribution.errorTypes['401_unauthorized']++; break;
          case 403: distribution.errorTypes['403_forbidden']++; break;
          case 429: distribution.errorTypes['429_rate_limited']++; break;
        }
      } else if (statusCode >= 500 && statusCode < 600) {
        distribution['5xx_server_error']++;
        switch (statusCode) {
          case 500: distribution.errorTypes['500_server_error']++; break;
          case 502: distribution.errorTypes['502_bad_gateway']++; break;
          case 503: distribution.errorTypes['503_unavailable']++; break;
        }
      }
    }

    return distribution;
  }

  /**
   * Cleanup method to clear all intervals and prevent memory leaks
   */
  cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    if (this.batchFlushInterval) {
      clearInterval(this.batchFlushInterval);
      this.batchFlushInterval = undefined;
    }
    if (this.dbCleanupInterval) {
      clearInterval(this.dbCleanupInterval);
      this.dbCleanupInterval = undefined;
    }
    
    // Flush any pending metrics before cleanup
    this.flushBatch();
  }
}

// Singleton instance
export const metricsCollector = new MetricsCollector();