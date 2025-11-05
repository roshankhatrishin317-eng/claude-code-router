/**
 * Session Affinity Manager
 *
 * This module provides advanced session affinity features including:
 * - Connection stickiness based on session ID
 * - Load balancing across multiple connections for a session
 * - Session-based request prioritization
 * - Session metrics and analytics
 */

import { EventEmitter } from 'events';
import { ConnectionInfo } from './sessionConnectionPool';

export interface SessionInfo {
  id: string;
  preferredConnectionId?: string;
  fallbackConnectionIds: string[];
  createdAt: number;
  lastActivityAt: number;
  requestCount: number;
  totalTokens: number;
  averageLatency: number;
  provider: string;
  priority: 'low' | 'normal' | 'high';
  sticky: boolean; // Whether to maintain connection affinity
}

export interface SessionMetrics {
  totalSessions: number;
  activeSessions: number;
  sessionsByProvider: Record<string, number>;
  sessionsByPriority: Record<string, number>;
  stickySessions: number;
  averageRequestsPerSession: number;
  topSessionsByActivity: SessionInfo[];
  timestamp?: number;
}

class SessionAffinityManager extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();
  private connectionSessions: Map<string, Set<string>> = new Map(); // connectionId -> sessionIds
  private sessionCleanupInterval: NodeJS.Timeout;
  private metricsHistory: SessionMetrics[] = [];
  private maxHistorySize = 100;

  constructor() {
    super();

    // Clean up inactive sessions every 5 minutes
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupInactiveSessions();
    }, 5 * 60 * 1000);
  }

  /**
   * Register a session with connection affinity
   */
  registerSession(
    sessionId: string,
    provider: string,
    priority: 'low' | 'normal' | 'high' = 'normal',
    sticky: boolean = true
  ): SessionInfo {
    let sessionInfo = this.sessions.get(sessionId);

    if (sessionInfo) {
      // Update existing session
      sessionInfo.lastActivityAt = Date.now();
      sessionInfo.priority = priority;
      sessionInfo.sticky = sticky;
    } else {
      // Create new session
      sessionInfo = {
        id: sessionId,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        requestCount: 0,
        totalTokens: 0,
        averageLatency: 0,
        provider,
        priority,
        sticky,
        fallbackConnectionIds: []
      };

      this.sessions.set(sessionId, sessionInfo);
      this.emit('sessionCreated', sessionInfo);
    }

    return sessionInfo;
  }

  /**
   * Get session information
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Associate a connection with a session
   */
  associateConnection(sessionId: string, connectionId: string, isPreferred: boolean = true): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Associate connection with session
    if (!this.connectionSessions.has(connectionId)) {
      this.connectionSessions.set(connectionId, new Set());
    }
    this.connectionSessions.get(connectionId)!.add(sessionId);

    // Set preferred connection for the session
    if (isPreferred) {
      session.preferredConnectionId = connectionId;
    } else if (!session.fallbackConnectionIds.includes(connectionId)) {
      session.fallbackConnectionIds.push(connectionId);
    }

    session.lastActivityAt = Date.now();
  }

  /**
   * Get the best connection for a session
   */
  getBestConnectionForSession(
    sessionId: string,
    availableConnections: ConnectionInfo[]
  ): ConnectionInfo | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return this.getLeastLoadedConnection(availableConnections);
    }

    // Update activity
    session.lastActivityAt = Date.now();
    session.requestCount++;

    // If session is sticky, try to use preferred connection
    if (session.sticky && session.preferredConnectionId) {
      const preferredConnection = availableConnections.find(
        conn => conn.id === session.preferredConnectionId &&
                conn.isHealthy &&
                conn.currentRequests < conn.maxConcurrentRequests
      );

      if (preferredConnection) {
        return preferredConnection;
      }
    }

    // Try fallback connections
    for (const fallbackId of session.fallbackConnectionIds) {
      const fallbackConnection = availableConnections.find(
        conn => conn.id === fallbackId &&
                conn.isHealthy &&
                conn.currentRequests < conn.maxConcurrentRequests
      );

      if (fallbackConnection) {
        return fallbackConnection;
      }
    }

    // Get best available connection based on load and session priority
    return this.getBestConnectionForPriority(session, availableConnections);
  }

  /**
   * Get best connection based on session priority
   */
  private getBestConnectionForPriority(
    session: SessionInfo,
    availableConnections: ConnectionInfo[]
  ): ConnectionInfo | null {
    // Sort connections by load (least loaded first)
    const sortedConnections = [...availableConnections].sort((a, b) => {
      const loadA = a.currentRequests / a.maxConcurrentRequests;
      const loadB = b.currentRequests / b.maxConcurrentRequests;
      return loadA - loadB;
    });

    // High priority sessions get better connections
    if (session.priority === 'high') {
      // Find connection with lowest load
      return sortedConnections[0] || null;
    }

    // Normal priority sessions get any available connection
    return sortedConnections.find(conn => conn.isHealthy) || null;
  }

  /**
   * Get least loaded connection (fallback for sessions without affinity)
   */
  private getLeastLoadedConnection(availableConnections: ConnectionInfo[]): ConnectionInfo | null {
    const healthyConnections = availableConnections.filter(conn => conn.isHealthy);

    if (healthyConnections.length === 0) return null;

    return healthyConnections.reduce((least, current) => {
      const loadLeast = least.currentRequests / least.maxConcurrentRequests;
      const loadCurrent = current.currentRequests / current.maxConcurrentRequests;
      return loadCurrent < loadLeast ? current : least;
    });
  }

  /**
   * Update session metrics after a request
   */
  updateSessionMetrics(
    sessionId: string,
    latency: number,
    tokens: number,
    success: boolean
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Update latency (running average)
    if (session.requestCount > 0) {
      session.averageLatency = (session.averageLatency * (session.requestCount - 1) + latency) / session.requestCount;
    } else {
      session.averageLatency = latency;
    }

    // Update token count
    session.totalTokens += tokens;

    // Emit metrics update
    this.emit('sessionMetricsUpdated', session, { latency, tokens, success });
  }

  /**
   * Remove session affinity when connection becomes unhealthy
   */
  removeConnectionFromSession(connectionId: string): void {
    const affectedSessionIds = this.connectionSessions.get(connectionId);
    if (!affectedSessionIds) return;

    for (const sessionId of affectedSessionIds) {
      const session = this.sessions.get(sessionId);
      if (!session) continue;

      // Remove from preferred connections
      if (session.preferredConnectionId === connectionId) {
        session.preferredConnectionId = undefined;
      }

      // Remove from fallback connections
      session.fallbackConnectionIds = session.fallbackConnectionIds.filter(
        id => id !== connectionId
      );

      this.emit('sessionConnectionLost', session, connectionId);
    }

    this.connectionSessions.delete(connectionId);
  }

  /**
   * Clean up inactive sessions
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivityAt > inactiveThreshold) {
        this.removeSession(sessionId);
      }
    }
  }

  /**
   * Remove a session
   */
  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clean up connection associations
    if (session.preferredConnectionId) {
      const connectionSessions = this.connectionSessions.get(session.preferredConnectionId);
      if (connectionSessions) {
        connectionSessions.delete(sessionId);
        if (connectionSessions.size === 0) {
          this.connectionSessions.delete(session.preferredConnectionId);
        }
      }
    }

    for (const connectionId of session.fallbackConnectionIds) {
      const connectionSessions = this.connectionSessions.get(connectionId);
      if (connectionSessions) {
        connectionSessions.delete(sessionId);
        if (connectionSessions.size === 0) {
          this.connectionSessions.delete(connectionId);
        }
      }
    }

    this.sessions.delete(sessionId);
    this.emit('sessionRemoved', session);
  }

  /**
   * Get session metrics
   */
  getMetrics(): SessionMetrics {
    const now = Date.now();
    const activeThreshold = 5 * 60 * 1000; // 5 minutes
    const activeSessions = Array.from(this.sessions.values()).filter(
      session => now - session.lastActivityAt < activeThreshold
    );

    const sessionsByProvider: Record<string, number> = {};
    const sessionsByPriority: Record<string, number> = { low: 0, normal: 0, high: 0 };

    let totalRequests = 0;
    let stickySessions = 0;

    for (const session of this.sessions.values()) {
      sessionsByProvider[session.provider] = (sessionsByProvider[session.provider] || 0) + 1;
      sessionsByPriority[session.priority]++;
      totalRequests += session.requestCount;
      if (session.sticky) stickySessions++;
    }

    // Top sessions by recent activity
    const topSessionsByActivity = Array.from(this.sessions.values())
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, 10);

    const metrics: SessionMetrics = {
      totalSessions: this.sessions.size,
      activeSessions: activeSessions.length,
      sessionsByProvider,
      sessionsByPriority,
      stickySessions,
      averageRequestsPerSession: this.sessions.size > 0 ? totalRequests / this.sessions.size : 0,
      topSessionsByActivity
    };

    // Store in history
    this.metricsHistory.push({ ...metrics, timestamp: now });
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory.shift();
    }

    return metrics;
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(): SessionMetrics[] {
    return [...this.metricsHistory];
  }

  /**
   * Optimize session connections
   */
  optimizeConnections(): void {
    // Rebalance sessions across connections
    for (const [sessionId, session] of this.sessions.entries()) {
      // If session's preferred connection is overloaded, find a better one
      if (session.preferredConnectionId) {
        const preferredConnection = this.findConnectionById(session.preferredConnectionId);
        if (preferredConnection &&
            preferredConnection.currentRequests >= preferredConnection.maxConcurrentRequests * 0.8) {
          // Mark preferred connection for replacement in next request
          session.preferredConnectionId = undefined;
          this.emit('sessionOptimized', session, 'preferred_connection_overloaded');
        }
      }
    }
  }

  /**
   * Find connection by ID (placeholder - would be implemented with connection pool integration)
   */
  private findConnectionById(connectionId: string): any {
    // This would integrate with the connection pool
    return null;
  }

  /**
   * Close the session affinity manager
   */
  close(): void {
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
    }

    this.sessions.clear();
    this.connectionSessions.clear();
    this.metricsHistory = [];

    this.emit('closed');
  }
}

// Global session affinity manager instance
export const sessionAffinityManager = new SessionAffinityManager();