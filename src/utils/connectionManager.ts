/**
 * Connection Manager - Integration layer for @musistudio/llms and Connection Pool
 *
 * This module provides an interface between the existing Fastify-based @musistudio/llms
 * architecture and our new session-based connection pooling system.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { connectionPool, ConnectionInfo, ProviderConfig } from './sessionConnectionPool';
import { sessionAffinityManager } from './sessionAffinity';

export interface PooledRequest {
  req: FastifyRequest;
  reply: FastifyReply;
  provider: string;
  sessionId?: string;
  startTime: number;
}

export interface RequestMetrics {
  provider: string;
  model: string;
  sessionId?: string;
  startTime: number;
  endTime: number;
  success: boolean;
  errorType?: string;
  inputTokens?: number;
  outputTokens?: number;
}

class ConnectionManager {
  private activeRequests: Map<string, PooledRequest> = new Map();
  private sessionAffinity: Map<string, string> = new Map(); // sessionId -> connectionId
  private requestMetrics: RequestMetrics[] = [];
  private metricsHistoryLimit = 1000;

  /**
   * Initialize the connection manager with provider configurations
   */
  initialize(providers: any[]): void {
    for (const provider of providers) {
      const config: ProviderConfig = {
        name: provider.name,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl || this.getDefaultBaseUrl(provider.name),
        maxConnections: provider.maxConnections || 5,
        rateLimitPerSecond: provider.rateLimitPerSecond || 10,
        rateLimitPerMinute: provider.rateLimitPerMinute || 100,
        timeout: provider.timeout || 30000
      };

      connectionPool.registerProvider(config);
    }

    // Listen to connection pool events
    connectionPool.on('metricsUpdated', this.handlePoolMetricsUpdated.bind(this));
    connectionPool.on('connectionCreated', this.handleConnectionCreated.bind(this));
    connectionPool.on('connectionUnhealthy', this.handleConnectionUnhealthy.bind(this));
    connectionPool.on('requestQueued', this.handleRequestQueued.bind(this));

    // Listen to session affinity events
    sessionAffinityManager.on('sessionCreated', this.handleSessionCreated.bind(this));
    sessionAffinityManager.on('sessionMetricsUpdated', this.handleSessionMetricsUpdated.bind(this));
  }

  /**
   * Parse request information (made public for server integration)
   */
  parseRequestInfo(req: FastifyRequest): { provider: string; sessionId?: string } {
    const body = req.body as any;
    let provider = 'unknown';

    // Extract provider from model if specified as "provider,model"
    if (body.model?.includes(',')) {
      [provider] = body.model.split(',');
    } else {
      // Default provider or extract from other sources
      provider = (req.headers['x-provider'] as string) || 'openrouter';
    }

    // Extract session ID from metadata
    let sessionId: string | undefined;
    if (body.metadata?.user_id) {
      const parts = body.metadata.user_id.split("_session_");
      if (parts.length > 1) {
        sessionId = parts[1];
      }
    }

    return { provider, sessionId };
  }

  /**
   * Get connection with session affinity (made public for server integration)
   */
  async getConnectionWithAffinity(provider: string, sessionId?: string): Promise<ConnectionInfo> {
    // Register session if it exists
    if (sessionId) {
      sessionAffinityManager.registerSession(sessionId, provider, 'normal', true);
    }

    // Get available connections from pool
    const allConnections = await this.getAllAvailableConnections(provider);

    if (sessionId) {
      // Use session affinity manager to get best connection
      const bestConnection = sessionAffinityManager.getBestConnectionForSession(
        sessionId,
        allConnections
      );

      if (bestConnection) {
        bestConnection.lastUsedAt = Date.now();
        bestConnection.currentRequests++;

        // Associate connection with session
        sessionAffinityManager.associateConnection(sessionId, bestConnection.id, true);

        // Update local affinity map for backwards compatibility
        this.sessionAffinity.set(sessionId, bestConnection.id);

        return bestConnection;
      }
    }

    // Fallback: get any available connection from the pool
    const connection = await connectionPool.getConnection(provider, sessionId);

    // Update session affinity if session exists
    if (sessionId) {
      this.sessionAffinity.set(sessionId, connection.id);
      sessionAffinityManager.associateConnection(sessionId, connection.id, true);
    }

    return connection;
  }

  /**
   * Get all available connections for a provider
   */
  private async getAllAvailableConnections(provider: string): Promise<ConnectionInfo[]> {
    try {
      // Get all connections from the connection pool for this provider
      const poolConnections = connectionPool.getProviderConnections(provider);
      return poolConnections.filter(conn => conn.isHealthy && conn.currentRequests < conn.maxConcurrentRequests);
    } catch (error) {
      console.error('Failed to get available connections:', error);
      return [];
    }
  }

  /**
   * Release connection back to pool (made public for server integration)
   */
  releaseConnection(connection: ConnectionInfo): void {
    connectionPool.releaseConnection(connection);
  }

  /**
   * Record request metrics (made public for server integration)
   */
  recordRequestMetrics(metrics: RequestMetrics): void {
    this.requestMetrics.push(metrics);

    // Keep only recent metrics
    if (this.requestMetrics.length > this.metricsHistoryLimit) {
      this.requestMetrics = this.requestMetrics.slice(-this.metricsHistoryLimit);
    }
  }

  /**
   * Find connection by ID
   */
  private findConnectionById(connectionId: string): ConnectionInfo | null {
    // Note: In a real implementation, we'd need access to the internal connections map
    // For now, this is a placeholder that would need to be implemented in the connection pool
    return null;
  }

  /**
   * Get default base URL for known providers
   */
  private getDefaultBaseUrl(providerName: string): string {
    const defaultUrls: Record<string, string> = {
      'openrouter': 'https://openrouter.ai/api/v1',
      'deepseek': 'https://api.deepseek.com',
      'openai': 'https://api.openai.com/v1',
      'anthropic': 'https://api.anthropic.com/v1',
      'google': 'https://generativelanguage.googleapis.com/v1beta',
      'groq': 'https://api.groq.com/openai/v1'
    };

    return defaultUrls[providerName.toLowerCase()] || 'https://api.example.com/v1';
  }

  /**
   * Get request metrics
   */
  getRequestMetrics(): RequestMetrics[] {
    return [...this.requestMetrics];
  }

  /**
   * Get provider performance metrics
   */
  getProviderMetrics(): Record<string, any> {
    const providerStats: Record<string, any> = {};

    for (const metrics of this.requestMetrics) {
      if (!providerStats[metrics.provider]) {
        providerStats[metrics.provider] = {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          averageLatency: 0,
          totalLatency: 0,
          errors: {}
        };
      }

      const stats = providerStats[metrics.provider];
      stats.totalRequests++;
      stats.totalLatency += (metrics.endTime - metrics.startTime);

      if (metrics.success) {
        stats.successfulRequests++;
      } else {
        stats.failedRequests++;
        if (metrics.errorType) {
          stats.errors[metrics.errorType] = (stats.errors[metrics.errorType] || 0) + 1;
        }
      }
    }

    // Calculate averages
    for (const [provider, stats] of Object.entries(providerStats)) {
      stats.averageLatency = stats.totalRequests > 0 ? stats.totalLatency / stats.totalRequests : 0;
      stats.successRate = stats.totalRequests > 0 ? (stats.successfulRequests / stats.totalRequests) * 100 : 0;
    }

    return providerStats;
  }

  /**
   * Event handlers
   */
  private handlePoolMetricsUpdated(metrics: any): void {
    // Could emit to monitoring system or log
  }

  private handleConnectionCreated(connection: ConnectionInfo, sessionId?: string): void {
    console.log(`New connection created: ${connection.id} for provider ${connection.provider}`);
  }

  private handleConnectionUnhealthy(connection: ConnectionInfo): void {
    console.log(`Connection marked as unhealthy: ${connection.id}`);
    // Clean up any session affinity
    for (const [sessionId, connectionId] of this.sessionAffinity.entries()) {
      if (connectionId === connection.id) {
        this.sessionAffinity.delete(sessionId);
        break;
      }
    }
  }

  private handleRequestQueued(request: any, sessionId?: string): void {
    console.log(`Request queued: ${request.id} for provider ${request.provider}`);
  }

  private handleSessionCreated(session: any): void {
    console.log(`Session created: ${session.id} for provider ${session.provider}`);
  }

  private handleSessionMetricsUpdated(session: any, metrics: any): void {
    console.log(`Session metrics updated: ${session.id}, latency: ${metrics.latency}ms, tokens: ${metrics.tokens}`);
  }

  /**
   * Get session affinity metrics
   */
  getSessionAffinityMetrics(): any {
    return sessionAffinityManager.getMetrics();
  }

  /**
   * Close the connection manager
   */
  close(): void {
    this.activeRequests.clear();
    this.sessionAffinity.clear();
    this.requestMetrics = [];
    sessionAffinityManager.close();
    connectionPool.close();
  }
}

// Global connection manager instance
export const connectionManager = new ConnectionManager();