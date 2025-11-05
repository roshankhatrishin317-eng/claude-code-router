/**
 * Session-based Connection Pool for LLM Providers
 *
 * This module implements a connection pooling system that reuses connections across requests
 * to bypass rate limits and improve performance.
 */

import { EventEmitter } from 'events';
import { providerStrategies } from './providerStrategies';

export interface ProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  maxConnections?: number;
  rateLimitPerSecond?: number;
  rateLimitPerMinute?: number;
  timeout?: number;
}

export interface ConnectionInfo {
  id: string;
  provider: string;
  createdAt: number;
  lastUsedAt: number;
  requestCount: number;
  isHealthy: boolean;
  currentRequests: number;
  maxConcurrentRequests: number;
}

export interface QueuedRequest {
  id: string;
  provider: string;
  priority: number;
  createdAt: number;
  resolve: (connection: ConnectionInfo) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface PoolMetrics {
  totalConnections: number;
  activeConnections: number;
  queuedRequests: number;
  averageResponseTime: number;
  providerMetrics: Record<string, {
    connections: number;
    activeRequests: number;
    queuedRequests: number;
    successRate: number;
    averageLatency: number;
  }>;
}

class ConnectionPool extends EventEmitter {
  private connections: Map<string, ConnectionInfo[]> = new Map();
  private requestQueues: Map<string, QueuedRequest[]> = new Map();
  private providers: Map<string, ProviderConfig> = new Map();
  private requestTimers: Map<string, NodeJS.Timeout> = new Map();
  private metrics: PoolMetrics;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    super();
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      queuedRequests: 0,
      averageResponseTime: 0,
      providerMetrics: {}
    };

    // Cleanup inactive connections every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveConnections();
    }, 30000);
  }

  /**
   * Register a new provider configuration
   */
  registerProvider(config: ProviderConfig): void {
    // Apply provider strategy to config
    const strategyConfig = providerStrategies.applyStrategyToConfig(config);

    this.providers.set(config.name, strategyConfig);
    this.connections.set(config.name, []);
    this.requestQueues.set(config.name, []);

    const strategy = providerStrategies.getStrategy(config.name);
    this.metrics.providerMetrics[config.name] = {
      connections: 0,
      activeRequests: 0,
      queuedRequests: 0,
      successRate: 100,
      averageLatency: 0
    };

    console.log(`Registered provider ${config.name} with strategy: maxConnections=${strategyConfig.maxConnections}, rateLimit=${strategyConfig.rateLimitPerMinute}/min`);
  }

  /**
   * Get a connection from the pool for a specific provider
   */
  async getConnection(provider: string, sessionId?: string): Promise<ConnectionInfo> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new Error(`Provider ${provider} not configured`);
    }

    // Check if we have an available connection
    const availableConnection = this.getAvailableConnection(provider);
    if (availableConnection) {
      availableConnection.lastUsedAt = Date.now();
      availableConnection.currentRequests++;
      return availableConnection;
    }

    // Check if we can create a new connection
    const providerConnections = this.connections.get(provider) || [];
    const maxConnections = providerConfig.maxConnections || 5;

    if (providerConnections.length < maxConnections) {
      const newConnection = this.createConnection(provider, sessionId);
      providerConnections.push(newConnection);
      newConnection.currentRequests++;
      this.updateMetrics();
      return newConnection;
    }

    // No available connections, queue the request
    return this.queueRequest(provider, sessionId);
  }

  /**
   * Release a connection back to the pool
   */
  releaseConnection(connection: ConnectionInfo): void {
    connection.currentRequests = Math.max(0, connection.currentRequests - 1);
    connection.lastUsedAt = Date.now();

    // Process next queued request if any
    this.processQueuedRequests(connection.provider);
    this.updateMetrics();
  }

  /**
   * Get an available connection for the provider
   */
  private getAvailableConnection(provider: string): ConnectionInfo | null {
    const connections = this.connections.get(provider) || [];
    return connections.find(conn =>
      conn.isHealthy &&
      conn.currentRequests < conn.maxConcurrentRequests
    ) || null;
  }

  /**
   * Create a new connection for the provider
   */
  private createConnection(provider: string, sessionId?: string): ConnectionInfo {
    const strategy = providerStrategies.getStrategy(provider);

    const connection: ConnectionInfo = {
      id: `${provider}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      provider,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      requestCount: 0,
      isHealthy: true,
      currentRequests: 0,
      maxConcurrentRequests: strategy.maxConcurrentRequests
    };

    this.emit('connectionCreated', connection, sessionId);
    return connection;
  }

  /**
   * Queue a request when no connections are available
   */
  private queueRequest(provider: string, sessionId?: string): Promise<ConnectionInfo> {
    return new Promise((resolve, reject) => {
      const queue = this.requestQueues.get(provider) || [];

      const queuedRequest: QueuedRequest = {
        id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        provider,
        priority: sessionId ? 1 : 0, // Prioritize session-based requests
        createdAt: Date.now(),
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.removeFromQueue(provider, queuedRequest.id);
          reject(new Error('Request timeout in queue'));
        }, 30000) // 30 second timeout
      };

      // Insert with priority (session requests first)
      const insertIndex = queue.findIndex(req => req.priority < queuedRequest.priority);
      if (insertIndex === -1) {
        queue.push(queuedRequest);
      } else {
        queue.splice(insertIndex, 0, queuedRequest);
      }

      this.requestQueues.set(provider, queue);
      this.metrics.queuedRequests++;

      this.emit('requestQueued', queuedRequest, sessionId);
    });
  }

  /**
   * Process queued requests for a provider
   */
  private processQueuedRequests(provider: string): void {
    const queue = this.requestQueues.get(provider) || [];
    if (queue.length === 0) return;

    const availableConnection = this.getAvailableConnection(provider);
    if (!availableConnection) return;

    const queuedRequest = queue.shift();
    if (!queuedRequest) return;

    clearTimeout(queuedRequest.timeout);
    availableConnection.currentRequests++;
    availableConnection.lastUsedAt = Date.now();

    this.metrics.queuedRequests--;
    this.requestQueues.set(provider, queue);

    queuedRequest.resolve(availableConnection);
    this.emit('requestDequeued', queuedRequest);
  }

  /**
   * Remove a request from the queue
   */
  private removeFromQueue(provider: string, requestId: string): void {
    const queue = this.requestQueues.get(provider) || [];
    const index = queue.findIndex(req => req.id === requestId);
    if (index !== -1) {
      queue.splice(index, 1);
      this.requestQueues.set(provider, queue);
      this.metrics.queuedRequests--;
    }
  }

  /**
   * Cleanup inactive connections
   */
  private cleanupInactiveConnections(): void {
    const now = Date.now();
    const inactiveThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [provider, connections] of this.connections.entries()) {
      const activeConnections = connections.filter(conn => {
        const isActive = now - conn.lastUsedAt < inactiveThreshold && conn.isHealthy;
        if (!isActive) {
          this.emit('connectionDestroyed', conn);
        }
        return isActive;
      });

      this.connections.set(provider, activeConnections);
    }

    this.updateMetrics();
  }

  /**
   * Update pool metrics
   */
  private updateMetrics(): void {
    let totalConnections = 0;
    let activeConnections = 0;
    let queuedRequests = 0;

    for (const [provider, connections] of this.connections.entries()) {
      const providerMetrics = this.metrics.providerMetrics[provider];
      if (!providerMetrics) continue;

      providerMetrics.connections = connections.length;
      providerMetrics.activeRequests = connections.reduce((sum, conn) => sum + conn.currentRequests, 0);

      totalConnections += connections.length;
      activeConnections += providerMetrics.activeRequests;
    }

    for (const queue of this.requestQueues.values()) {
      queuedRequests += queue.length;
    }

    this.metrics.totalConnections = totalConnections;
    this.metrics.activeConnections = activeConnections;
    this.metrics.queuedRequests = queuedRequests;

    this.emit('metricsUpdated', this.metrics);
  }

  /**
   * Get current pool metrics
   */
  getMetrics(): PoolMetrics {
    return { ...this.metrics };
  }

  /**
   * Get all connections for a specific provider
   */
  getProviderConnections(provider: string): ConnectionInfo[] {
    return this.connections.get(provider) || [];
  }

  /**
   * Mark a connection as unhealthy
   */
  markConnectionUnhealthy(connectionId: string): void {
    for (const [provider, connections] of this.connections.entries()) {
      const connection = connections.find(conn => conn.id === connectionId);
      if (connection) {
        connection.isHealthy = false;
        this.emit('connectionUnhealthy', connection);
        break;
      }
    }
  }

  /**
   * Execute operation with provider-specific retry logic
   */
  async executeWithRetry<T>(
    provider: string,
    operation: () => Promise<T>,
    context?: string
  ): Promise<T> {
    return providerStrategies.executeWithRetry(provider, operation, context);
  }

  /**
   * Check if an error should mark connection as unhealthy
   */
  shouldMarkConnectionUnhealthy(provider: string, error: any): boolean {
    return providerStrategies.shouldMarkConnectionUnhealthy(provider, error);
  }

  /**
   * Close all connections and cleanup
   */
  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Clear all timeouts
    for (const timeout of this.requestTimers.values()) {
      clearTimeout(timeout);
    }
    this.requestTimers.clear();

    // Clear queues
    for (const [provider, queue] of this.requestQueues.entries()) {
      for (const request of queue) {
        clearTimeout(request.timeout);
        request.reject(new Error('Connection pool shutting down'));
      }
    }
    this.requestQueues.clear();

    // Close connections
    this.connections.clear();
    this.providers.clear();

    this.emit('poolClosed');
  }
}

// Global connection pool instance
export const connectionPool = new ConnectionPool();

// Handle process shutdown gracefully
process.on('SIGINT', () => {
  connectionPool.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  connectionPool.close();
  process.exit(0);
});