/**
 * SQLite Database for Persistent Metrics Storage
 *
 * This module provides persistent storage for metrics data using SQLite,
 * enabling historical analytics beyond the in-memory 10K limit.
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { RequestMetrics } from './metrics';
import { homedir } from 'os';

export interface HistoricalQuery {
  startTime?: number;
  endTime?: number;
  provider?: string;
  model?: string;
  limit?: number;
  aggregateBy?: 'hour' | 'day' | 'week';
}

export interface AggregatedMetrics {
  period: string;
  requestCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  averageLatency: number;
  errorCount: number;
  totalCost: number;
}

export class MetricsDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor() {
    // Create data directory
    const dataDir = join(homedir(), '.claude-code-router', 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = join(dataDir, 'metrics.db');
    this.db = new Database(this.dbPath);

    this.initializeDatabase();
  }

  /**
   * Initialize database schema
   */
  private initializeDatabase(): void {
    try {
      // Create requests table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          session_id TEXT,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          input_tokens INTEGER DEFAULT 0,
          output_tokens INTEGER DEFAULT 0,
          duration_ms INTEGER NOT NULL,
          status_code INTEGER,
          success BOOLEAN NOT NULL,
          error_type TEXT,
          ip_address TEXT,
          user_agent TEXT,
          first_token_latency INTEGER,
          streaming_efficiency REAL,
          cost_usd REAL DEFAULT 0
        )
      `);

      // Create indexes for better query performance
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
        CREATE INDEX IF NOT EXISTS idx_requests_provider ON requests(provider);
        CREATE INDEX IF NOT EXISTS idx_requests_model ON requests(model);
        CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
        CREATE INDEX IF NOT EXISTS idx_requests_success ON requests(success);
        CREATE INDEX IF NOT EXISTS idx_requests_status_code ON requests(status_code);
      `);

      // Create aggregated_hourly table for faster historical queries
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS aggregated_hourly (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hour_timestamp INTEGER NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          request_count INTEGER DEFAULT 0,
          total_input_tokens INTEGER DEFAULT 0,
          total_output_tokens INTEGER DEFAULT 0,
          total_duration_ms INTEGER DEFAULT 0,
          error_count INTEGER DEFAULT 0,
          total_cost REAL DEFAULT 0,
          UNIQUE(hour_timestamp, provider, model)
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_aggregated_hour ON aggregated_hourly(hour_timestamp);
        CREATE INDEX IF NOT EXISTS idx_aggregated_provider ON aggregated_hourly(provider);
      `);

      // Create provider_health table for circuit breaker tracking
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS provider_health (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          provider TEXT NOT NULL,
          model TEXT,
          status TEXT NOT NULL,
          failure_count INTEGER DEFAULT 0,
          response_time_ms INTEGER,
          error_message TEXT,
          UNIQUE(timestamp, provider, model)
        )
      `);

      console.log('[METRICS-DB] Database initialized successfully at:', this.dbPath);
    } catch (error) {
      console.error('[METRICS-DB] Error initializing database:', error);
      throw error;
    }
  }

  /**
   * Insert a single request metric
   */
  insertRequest(metrics: RequestMetrics): void {
    const stmt = this.db.prepare(`
      INSERT INTO requests (
        timestamp, session_id, provider, model, input_tokens, output_tokens,
        duration_ms, status_code, success, error_type, ip_address,
        user_agent, first_token_latency, streaming_efficiency, cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      metrics.timestamp,
      metrics.sessionId,
      metrics.provider,
      metrics.model,
      metrics.inputTokens,
      metrics.outputTokens,
      metrics.duration,
      metrics.statusCode,
      metrics.success ? 1 : 0,
      metrics.errorType,
      metrics.ipAddress,
      metrics.userAgent,
      metrics.firstTokenLatency,
      metrics.streamingEfficiency,
      this.calculateRequestCost(metrics)
    );
  }

  /**
   * Batch insert request metrics for better performance
   */
  insertRequestsBatch(metricsArray: RequestMetrics[]): void {
    if (!metricsArray || metricsArray.length === 0) {
      return;
    }

    try {
      const stmt = this.db.prepare(`
        INSERT INTO requests (
          timestamp, session_id, provider, model, input_tokens, output_tokens,
          duration_ms, status_code, success, error_type, ip_address,
          user_agent, first_token_latency, streaming_efficiency, cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const transaction = this.db.transaction((metricsArray: RequestMetrics[]) => {
        for (const metric of metricsArray) {
          try {
            stmt.run(
              metric.timestamp,
              metric.sessionId || null,
              metric.provider,
              metric.model,
              metric.inputTokens || 0,
              metric.outputTokens || 0,
              metric.duration,
              metric.statusCode || null,
              metric.success ? 1 : 0,
              metric.errorType || null,
              metric.ipAddress || null,
              metric.userAgent || null,
              metric.firstTokenLatency || null,
              metric.streamingEfficiency || null,
              this.calculateRequestCost(metric)
            );
          } catch (insertError) {
            console.error('Error inserting metric:', insertError, metric);
            // Continue with other metrics
          }
        }
      });

      transaction(metricsArray);
    } catch (error) {
      console.error('Error in batch insert transaction:', error);
      throw error;
    }
  }

  /**
   * Query historical metrics with filtering and aggregation
   */
  queryHistoricalMetrics(query: HistoricalQuery): AggregatedMetrics[] {
    try {
      let sql = `
        SELECT
          datetime(timestamp / 1000, 'unixepoch', 'localtime') as period,
          COUNT(*) as request_count,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens,
          AVG(duration_ms) as average_latency,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as error_count,
          SUM(cost_usd) as total_cost
        FROM requests
        WHERE 1=1
      `;

      const params: any[] = [];

      if (query.startTime) {
        sql += ' AND timestamp >= ?';
        params.push(query.startTime);
      }

      if (query.endTime) {
        sql += ' AND timestamp <= ?';
        params.push(query.endTime);
      }

      if (query.provider) {
        sql += ' AND provider = ?';
        params.push(query.provider);
      }

      if (query.model) {
        sql += ' AND model = ?';
        params.push(query.model);
      }

      sql += ' GROUP BY period ORDER BY period DESC';

      if (query.limit) {
        sql += ' LIMIT ?';
        params.push(query.limit);
      }

      const stmt = this.db.prepare(sql);
      const result = stmt.all(...params) as any[];

      return result.map(row => ({
        period: row.period,
        requestCount: row.request_count || 0,
        totalInputTokens: row.total_input_tokens || 0,
        totalOutputTokens: row.total_output_tokens || 0,
        averageLatency: Math.round(row.average_latency || 0),
        errorCount: row.error_count || 0,
        totalCost: row.total_cost || 0
      }));
    } catch (error) {
      console.error('[METRICS-DB] Error querying historical metrics:', error);
      return [];
    }
  }

  /**
   * Get provider performance metrics over time
   */
  getProviderPerformance(provider: string, hours: number = 24): any[] {
    const startTime = Date.now() - (hours * 60 * 60 * 1000);

    const stmt = this.db.prepare(`
      SELECT
        datetime(timestamp / 1000, 'unixepoch', 'localtime') as hour,
        COUNT(*) as requests,
        AVG(duration_ms) as avg_latency,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as error_rate,
        SUM(input_tokens + output_tokens) as total_tokens,
        SUM(cost_usd) as total_cost
      FROM requests
      WHERE provider = ? AND timestamp >= ?
      GROUP BY strftime('%Y-%m-%d %H:00:00', datetime(timestamp / 1000, 'unixepoch', 'localtime'))
      ORDER BY hour DESC
    `);

    return stmt.all(provider, startTime);
  }

  /**
   * Get top models by usage
   */
  getTopModels(limit: number = 10): any[] {
    const stmt = this.db.prepare(`
      SELECT
        provider,
        model,
        COUNT(*) as request_count,
        SUM(input_tokens + output_tokens) as total_tokens,
        SUM(cost_usd) as total_cost,
        AVG(duration_ms) as avg_latency
      FROM requests
      WHERE timestamp >= ?
      GROUP BY provider, model
      ORDER BY total_tokens DESC
      LIMIT ?
    `);

    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    return stmt.all(oneDayAgo, limit);
  }

  /**
   * Get cost analytics by time period
   */
  getCostAnalytics(days: number = 30): any[] {
    const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    const stmt = this.db.prepare(`
      SELECT
        date(timestamp / 1000, 'unixepoch', 'localtime') as date,
        provider,
        SUM(cost_usd) as daily_cost,
        COUNT(*) as request_count,
        SUM(input_tokens + output_tokens) as total_tokens
      FROM requests
      WHERE timestamp >= ?
      GROUP BY date, provider
      ORDER BY date DESC, daily_cost DESC
    `);

    return stmt.all(startTime);
  }

  /**
   * Clean up old data (keep data for specified days)
   */
  cleanupOldData(daysToKeep: number = 90): void {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

    const stmt = this.db.prepare('DELETE FROM requests WHERE timestamp < ?');
    const result = stmt.run(cutoffTime);

    console.log(`Cleaned up ${result.changes} old metric records older than ${daysToKeep} days`);
  }

  /**
   * Aggregate hourly data for faster queries
   */
  aggregateHourlyData(): void {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const hourStart = Math.floor(oneHourAgo / (60 * 60 * 1000)) * (60 * 60 * 1000);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO aggregated_hourly (
        hour_timestamp, provider, model, request_count, total_input_tokens,
        total_output_tokens, total_duration_ms, error_count, total_cost
      )
      SELECT
        ? as hour_timestamp,
        provider,
        model,
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(duration_ms) as total_duration_ms,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as error_count,
        SUM(cost_usd) as total_cost
      FROM requests
      WHERE timestamp >= ? AND timestamp < ?
      GROUP BY provider, model
    `);

    const result = stmt.run(hourStart, hourStart, hourStart + (60 * 60 * 1000));
    console.log(`Aggregated hourly data: ${result.changes} provider/model combinations`);
  }

  /**
   * Get database statistics
   */
  getDatabaseStats(): {
    totalRequests: number;
    databaseSize: number;
    dateRange: { earliest: string; latest: string };
    providers: string[];
  } {
    try {
      const totalRequests = this.db.prepare('SELECT COUNT(*) as count FROM requests').get() as any;
      const dbStats = this.db.prepare('PRAGMA page_count').get() as any;
      const pageSize = this.db.prepare('PRAGMA page_size').get() as any;
      const databaseSize = dbStats.page_count * pageSize.page_size;

      const dateRange = this.db.prepare(`
        SELECT
          MIN(datetime(timestamp / 1000, 'unixepoch', 'localtime')) as earliest,
          MAX(datetime(timestamp / 1000, 'unixepoch', 'localtime')) as latest
        FROM requests
      `).get() as any;

      const providers = this.db.prepare('SELECT DISTINCT provider FROM requests').all() as any[];

      return {
        totalRequests: totalRequests?.count || 0,
        databaseSize: databaseSize || 0,
        dateRange: {
          earliest: dateRange?.earliest || 'N/A',
          latest: dateRange?.latest || 'N/A'
        },
        providers: providers.map(p => p.provider)
      };
    } catch (error) {
      console.error('[METRICS-DB] Error getting database stats:', error);
      return {
        totalRequests: 0,
        databaseSize: 0,
        dateRange: { earliest: 'N/A', latest: 'N/A' },
        providers: []
      };
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    console.log('Metrics database connection closed');
  }

  /**
   * Calculate cost for a single request (simplified pricing)
   */
  private calculateRequestCost(metrics: RequestMetrics): number {
    // Use simplified pricing model - in production, this would be more sophisticated
    const pricingRates: Record<string, { input: number; output: number }> = {
      'openai:gpt-4': { input: 0.03, output: 0.06 },
      'openai:gpt-4-turbo': { input: 0.01, output: 0.03 },
      'anthropic:claude-3-opus': { input: 0.015, output: 0.075 },
      'anthropic:claude-3-sonnet': { input: 0.003, output: 0.015 },
      'deepseek:deepseek-chat': { input: 0.00014, output: 0.00028 }
    };

    const key = `${metrics.provider}:${metrics.model}`;
    const rates = pricingRates[key] || { input: 0.001, output: 0.002 }; // Default rates

    return (metrics.inputTokens / 1000) * rates.input + (metrics.outputTokens / 1000) * rates.output;
  }
}

// Singleton instance
export const metricsDatabase = new MetricsDatabase();
