import { EventEmitter } from 'node:events';

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
}

export interface RealTimeMetrics {
  requestsPerMinute: number;
  tokensPerSecond: number;
  activeSessions: number;
  totalRequests: number;
  errorRate: number;
  averageLatency: number;
  inputTokensPerMinute: number;
  outputTokensPerMinute: number;
  totalInputTokens: number;
  totalOutputTokens: number;
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
  private lastSecondTokens: { tokens: number; timestamp: number }[] = [];

  private readonly MAX_HISTORY_SIZE = 10000;
  private readonly ONE_MINUTE = 60 * 1000;
  private readonly ONE_SECOND = 1000;

  // Default token costs (can be overridden per provider/model)
  private tokenCosts: Map<string, TokenCosts> = new Map([
    ['anthropic:claude-3-opus', { inputCostPer1K: 0.015, outputCostPer1K: 0.075 }],
    ['anthropic:claude-3-sonnet', { inputCostPer1K: 0.003, outputCostPer1K: 0.015 }],
    ['anthropic:claude-3-haiku', { inputCostPer1K: 0.00025, outputCostPer1K: 0.00125 }],
    ['openai:gpt-4', { inputCostPer1K: 0.03, outputCostPer1K: 0.06 }],
    ['openai:gpt-4-turbo', { inputCostPer1K: 0.01, outputCostPer1K: 0.03 }],
    ['openai:gpt-3.5-turbo', { inputCostPer1K: 0.001, outputCostPer1K: 0.002 }],
  ]);

  constructor() {
    super();
    // Clean up old data every minute
    setInterval(() => this.cleanupOldData(), 60 * 1000);
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
      timestamp: metrics.timestamp
    });

    // Emit event for real-time updates
    this.emit('metricsUpdated', this.getRealTimeMetrics());
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

    // Calculate average latency
    const recentLatencies = this.lastMinuteRequests.map(req => req.duration);
    const averageLatency = recentLatencies.length > 0
      ? recentLatencies.reduce((sum, lat) => sum + lat, 0) / recentLatencies.length
      : 0;

    return {
      requestsPerMinute: rpm,
      tokensPerSecond: tps,
      activeSessions: this.activeSessions.size,
      totalRequests: this.requestHistory.length,
      errorRate: Math.round(errorRate * 100) / 100,
      averageLatency: Math.round(averageLatency),
      inputTokensPerMinute,
      outputTokensPerMinute,
      totalInputTokens,
      totalOutputTokens
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
}

// Singleton instance
export const metricsCollector = new MetricsCollector();