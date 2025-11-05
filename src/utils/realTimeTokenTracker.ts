/**
 * Advanced Real-Time Token Tracking System
 *
 * This module provides high-precision, sub-second token tracking
 * for real-time TPS (Tokens Per Second) calculations.
 */

export interface TokenData {
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
}

export class RealTimeTokenTracker {
  private static instance: RealTimeTokenTracker;
  private tokenBuffers: Map<string, TokenData> = new Map();
  private tokenHistory: TokenData[] = [];
  private readonly HISTORY_WINDOW = 2000; // 2 seconds window for smoothing
  private readonly CLEANUP_INTERVAL = 5000; // Cleanup every 5 seconds
  private readonly MAX_HISTORY_SIZE = 2000; // Keep last 2000 data points
  private cleanupInterval?: NodeJS.Timeout;

  private constructor() {
    // Clean up old data periodically
    this.cleanupInterval = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }

  static getInstance(): RealTimeTokenTracker {
    if (!RealTimeTokenTracker.instance) {
      RealTimeTokenTracker.instance = new RealTimeTokenTracker();
    }
    return RealTimeTokenTracker.instance;
  }

  /**
   * Add token data with millisecond precision
   */
  addTokenData(sessionId: string, inputTokens: number, outputTokens: number) {
    const now = Date.now();
    const tokenData: TokenData = {
      inputTokens,
      outputTokens,
      timestamp: now
    };

    // Update session buffer
    this.tokenBuffers.set(sessionId, tokenData);

    // Add to history for TPS calculation
    this.tokenHistory.push(tokenData);

    // Maintain history size
    if (this.tokenHistory.length > this.MAX_HISTORY_SIZE) {
      this.tokenHistory.shift();
    }
  }

  /**
   * Get advanced TPS calculation with smoothing
   */
  getTPS(): { inputTPS: number; outputTPS: number } {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Get data from last second
    const recentData = this.tokenHistory.filter(data =>
      data.timestamp >= oneSecondAgo
    );

    if (recentData.length === 0) {
      return { inputTPS: 0, outputTPS: 0 };
    }

    // Calculate TPS with smoothing
    let totalInputTPS = 0;
    let totalOutputTPS = 0;

    for (const data of recentData) {
      totalInputTPS += data.inputTokens;
      totalOutputTPS += data.outputTokens;
    }

    // Enhanced smoothing using weighted average
    const weights = this.calculateWeights(recentData, oneSecondAgo);
    if (weights.length > 0 && weights.length === recentData.length) {
      let weightedInputTPS = 0;
      let weightedOutputTPS = 0;
      let totalWeight = 0;

      for (let i = 0; i < recentData.length; i++) {
        weightedInputTPS += recentData[i].inputTokens * weights[i];
        weightedOutputTPS += recentData[i].outputTokens * weights[i];
        totalWeight += weights[i];
      }

      // Prevent division by zero
      if (totalWeight > 0) {
        totalInputTPS = weightedInputTPS / totalWeight;
        totalOutputTPS = weightedOutputTPS / totalWeight;
      }
    }

    return {
      inputTPS: Math.round(totalInputTPS * 100) / 100, // Round to 2 decimal places
      outputTPS: Math.round(totalOutputTPS * 100) / 100
    };
  }

  /**
   * Get session-specific TPS
   */
  getSessionTPS(sessionId: string): { inputTPS: number; outputTPS: number } {
    const data = this.tokenBuffers.get(sessionId);
    if (!data) {
      return { inputTPS: 0, outputTPS: 0 };
    }

    const now = Date.now();
    const oneSecondAgo = now - 1000;

    if (data.timestamp >= oneSecondAgo) {
      return {
        inputTPS: data.inputTokens,
        outputTPS: data.outputTokens
      };
    }

    return { inputTPS: 0, outputTPS: 0 };
  }

  /**
   * Get TPS trend (increasing/decreasing)
   */
  getTPSTrend(): { inputTrend: 'up' | 'down' | 'stable'; outputTrend: 'up' | 'down' | 'stable' } {
    const now = Date.now();
    const recent500ms = this.tokenHistory.filter(data =>
      data.timestamp >= now - 500
    );
    const older500ms = this.tokenHistory.filter(data =>
      data.timestamp >= now - 1000 && data.timestamp < now - 500
    );

    const recentInputTPS = recent500ms.reduce((sum, data) => sum + data.inputTokens, 0);
    const olderInputTPS = older500ms.reduce((sum, data) => sum + data.inputTokens, 0);
    const recentOutputTPS = recent500ms.reduce((sum, data) => sum + data.outputTokens, 0);
    const olderOutputTPS = older500ms.reduce((sum, data) => sum + data.outputTokens, 0);

    return {
      inputTrend: this.getTrendDirection(recentInputTPS, olderInputTPS),
      outputTrend: this.getTrendDirection(recentOutputTPS, olderOutputTPS)
    };
  }

  private getTrendDirection(recent: number, older: number): 'up' | 'down' | 'stable' {
    const threshold = 0.1; // 10% change threshold
    if (older === 0) return 'stable';

    const change = (recent - older) / older;
    if (change > threshold) return 'up';
    if (change < -threshold) return 'down';
    return 'stable';
  }

  private calculateWeights(data: TokenData[], oneSecondAgo: number): number[] {
    const weights: number[] = [];
    const now = Date.now();

    for (const item of data) {
      // More recent data gets higher weight
      const age = now - item.timestamp;
      const weight = Math.max(0.1, 1 - (age / 1000)); // Linear decay over 1 second
      weights.push(weight);
    }

    return weights;
  }

  private cleanup() {
    const now = Date.now();
    const twoSecondsAgo = now - this.HISTORY_WINDOW;

    // Clean token history
    this.tokenHistory = this.tokenHistory.filter(data =>
      data.timestamp >= twoSecondsAgo
    );

    // Clean old session buffers
    for (const [sessionId, data] of this.tokenBuffers.entries()) {
      if (data.timestamp < twoSecondsAgo) {
        this.tokenBuffers.delete(sessionId);
      }
    }
  }

  /**
   * Get detailed statistics
   */
  getStats() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    const recentData = this.tokenHistory.filter(data => data.timestamp >= oneMinuteAgo);
    const activeSessions = this.tokenBuffers.size;

    return {
      activeSessions,
      totalRequests: recentData.length,
      averageInputTokens: recentData.length > 0
        ? recentData.reduce((sum, data) => sum + data.inputTokens, 0) / recentData.length
        : 0,
      averageOutputTokens: recentData.length > 0
        ? recentData.reduce((sum, data) => sum + data.outputTokens, 0) / recentData.length
        : 0,
      totalInputTokens: recentData.reduce((sum, data) => sum + data.inputTokens, 0),
      totalOutputTokens: recentData.reduce((sum, data) => sum + data.outputTokens, 0)
    };
  }

  /**
   * Cleanup method to clear intervals and prevent memory leaks
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.tokenBuffers.clear();
    this.tokenHistory = [];
  }
}

// Export singleton instance
export const realTimeTokenTracker = RealTimeTokenTracker.getInstance();