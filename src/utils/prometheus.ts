/**
 * Prometheus Metrics Export
 *
 * This module provides Prometheus-compatible metrics export for integration
 * with Grafana, DataDog, and other monitoring systems.
 */

import { metricsCollector } from './metrics';
import { systemHealthMonitor } from './systemHealth';
import { circuitBreakerManager } from './circuitBreaker';

export interface PrometheusMetric {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  labels?: Record<string, string>;
  value: number;
}

export class PrometheusExporter {
  private metrics: Map<string, PrometheusMetric> = new Map();

  /**
   * Generate Prometheus metrics text format
   */
  generateMetricsText(): string {
    this.updateMetrics();
    return this.formatMetricsAsPrometheus();
  }

  /**
   * Update all metrics from collectors
   */
  private updateMetrics(): void {
    // Clear existing metrics
    this.metrics.clear();

    // Real-time metrics
    const realTimeMetrics = metricsCollector.getRealTimeMetrics();

    this.addCounter('ccr_requests_total', 'Total number of requests', realTimeMetrics.totalRequests);
    this.addGauge('ccr_requests_per_minute', 'Requests per minute', realTimeMetrics.requestsPerMinute);
    this.addGauge('ccr_tokens_per_second', 'Tokens per second', realTimeMetrics.tokensPerSecond);
    this.addGauge('ccr_input_tokens_per_second', 'Input tokens per second', realTimeMetrics.inputTPS);
    this.addGauge('ccr_output_tokens_per_second', 'Output tokens per second', realTimeMetrics.outputTPS);
    this.addGauge('ccr_active_sessions', 'Number of active sessions', realTimeMetrics.activeSessions);
    this.addGauge('ccr_error_rate_percent', 'Error rate percentage', realTimeMetrics.errorRate);
    this.addGauge('ccr_average_latency_ms', 'Average latency in milliseconds', realTimeMetrics.averageLatency);

    // Latency percentiles
    this.addGauge('ccr_latency_p50_ms', 'P50 latency in milliseconds', realTimeMetrics.latencyPercentiles.p50);
    this.addGauge('ccr_latency_p95_ms', 'P95 latency in milliseconds', realTimeMetrics.latencyPercentiles.p95);
    this.addGauge('ccr_latency_p99_ms', 'P99 latency in milliseconds', realTimeMetrics.latencyPercentiles.p99);
    this.addGauge('ccr_latency_p999_ms', 'P999 latency in milliseconds', realTimeMetrics.latencyPercentiles.p999);

    // Status code distribution
    this.addCounter('ccr_status_codes_total', 'Total requests by status code', 0, {
      code: '2xx'
    }, realTimeMetrics.statusCodeDistribution['2xx_success']);
    this.addCounter('ccr_status_codes_total', 'Total requests by status code', 0, {
      code: '4xx'
    }, realTimeMetrics.statusCodeDistribution['4xx_client_error']);
    this.addCounter('ccr_status_codes_total', 'Total requests by status code', 0, {
      code: '5xx'
    }, realTimeMetrics.statusCodeDistribution['5xx_server_error']);

    // Token metrics
    this.addCounter('ccr_input_tokens_total', 'Total input tokens', realTimeMetrics.totalInputTokens);
    this.addCounter('ccr_output_tokens_total', 'Total output tokens', realTimeMetrics.totalOutputTokens);
    this.addGauge('ccr_input_tokens_per_minute', 'Input tokens per minute', realTimeMetrics.inputTokensPerMinute);
    this.addGauge('ccr_output_tokens_per_minute', 'Output tokens per minute', realTimeMetrics.outputTokensPerMinute);

    // System health metrics
    const healthStatus = systemHealthMonitor.getHealthStatus();
    this.addGauge('ccr_system_health_score', 'System health score (0-100)', healthStatus.score);
    this.addGauge('ccr_cpu_usage_percent', 'CPU usage percentage', healthStatus.cpuUsage);
    this.addGauge('ccr_memory_usage_percent', 'Memory usage percentage', healthStatus.memoryUsage);
    this.addGauge('ccr_heap_usage_percent', 'Heap usage percentage', healthStatus.heapUsage);
    this.addGauge('ccr_event_loop_delay_ms', 'Event loop delay in milliseconds', healthStatus.eventLoopDelay);

    // Circuit breaker metrics
    const cbStatuses = circuitBreakerManager.getAllStatuses();
    cbStatuses.forEach(status => {
      this.addGauge('ccr_circuit_breaker_state', 'Circuit breaker state (0=closed, 1=half_open, 2=open)', this.getStateNumeric(status.state), {
        provider: status.provider,
        model: status.model || ''
      });
      this.addGauge('ccr_circuit_breaker_failure_rate', 'Circuit breaker failure rate', status.metrics.failureRate, {
        provider: status.provider,
        model: status.model || ''
      });
    });

    // Provider metrics
    const providerMetrics = metricsCollector.getProviderMetrics();
    providerMetrics.forEach(provider => {
      this.addCounter('ccr_provider_requests_total', 'Total requests by provider', provider.requests, {
        provider: provider.provider,
        model: provider.model
      });
      this.addCounter('ccr_provider_input_tokens_total', 'Total input tokens by provider', provider.inputTokens, {
        provider: provider.provider,
        model: provider.model
      });
      this.addCounter('ccr_provider_output_tokens_total', 'Total output tokens by provider', provider.outputTokens, {
        provider: provider.provider,
        model: provider.model
      });
      this.addCounter('ccr_provider_errors_total', 'Total errors by provider', provider.errors, {
        provider: provider.provider,
        model: provider.model
      });
      this.addGauge('ccr_provider_average_latency_ms', 'Average latency by provider', provider.averageLatency, {
        provider: provider.provider,
        model: provider.model
      });
      this.addGauge('ccr_provider_total_cost_usd', 'Total cost by provider', provider.totalCost, {
        provider: provider.provider,
        model: provider.model
      });
    });

    // Token analytics
    const tokenAnalytics = metricsCollector.getTokenAnalytics();
    this.addGauge('ccr_total_input_tokens', 'Total input tokens', tokenAnalytics.totalInputTokens);
    this.addGauge('ccr_total_output_tokens', 'Total output tokens', tokenAnalytics.totalOutputTokens);
    this.addGauge('ccr_total_cost_usd', 'Total cost in USD', tokenAnalytics.totalCost);
    this.addGauge('ccr_average_tokens_per_request', 'Average tokens per request', tokenAnalytics.averageTokensPerRequest);
    this.addGauge('ccr_input_to_output_ratio', 'Input to output token ratio', tokenAnalytics.inputToOutputRatio);
  }

  /**
   * Format metrics as Prometheus text format
   */
  private formatMetricsAsPrometheus(): string {
    let output = '';
    const groupedMetrics = new Map<string, PrometheusMetric[]>();

    // Group metrics by name
    for (const metric of this.metrics.values()) {
      const name = metric.name;
      if (!groupedMetrics.has(name)) {
        groupedMetrics.set(name, []);
      }
      groupedMetrics.get(name)!.push(metric);
    }

    // Format each metric group
    for (const [name, metrics] of groupedMetrics) {
      const firstMetric = metrics[0];

      // Add help comment
      output += `# HELP ${name} ${firstMetric.help}\n`;

      // Add type comment
      output += `# TYPE ${name} ${firstMetric.type}\n`;

      // Add metrics
      metrics.forEach(metric => {
        const labels = this.formatLabels(metric.labels);
        output += `${name}${labels} ${metric.value}\n`;
      });

      output += '\n';
    }

    return output;
  }

  /**
   * Format labels for Prometheus
   */
  private formatLabels(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return '';
    }

    const formattedLabels = Object.entries(labels)
      .map(([key, value]) => `${key}="${this.escapeLabelValue(value)}"`)
      .join(',');

    return `{${formattedLabels}}`;
  }

  /**
   * Escape label values for Prometheus
   */
  private escapeLabelValue(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }

  /**
   * Convert circuit breaker state to numeric value
   */
  private getStateNumeric(state: string): number {
    switch (state) {
      case 'CLOSED': return 0;
      case 'HALF_OPEN': return 1;
      case 'OPEN': return 2;
      default: return -1;
    }
  }

  /**
   * Add counter metric
   */
  private addCounter(name: string, help: string, value: number, labels?: Record<string, string>, actualValue?: number): void {
    this.metrics.set(`${name}_${JSON.stringify(labels || {})}`, {
      name,
      help,
      type: 'counter',
      labels,
      value: actualValue !== undefined ? actualValue : value
    });
  }

  /**
   * Add gauge metric
   */
  private addGauge(name: string, help: string, value: number, labels?: Record<string, string>): void {
    this.metrics.set(`${name}_${JSON.stringify(labels || {})}`, {
      name,
      help,
      type: 'gauge',
      labels,
      value
    });
  }

  /**
   * Get OpenTelemetry metrics format
   */
  generateOpenTelemetryMetrics(): any {
    const realTimeMetrics = metricsCollector.getRealTimeMetrics();
    const healthStatus = systemHealthMonitor.getHealthStatus();

    return {
      resource_metrics: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'claude-code-router' } },
            { key: 'service.version', value: { stringValue: '1.0.65' } }
          ]
        },
        instrumentation_library_metrics: [{
          metrics: [
            // Request metrics
            {
              name: 'ccr.requests.total',
              description: 'Total number of requests',
              unit: '1',
              sum: {
                dataPoints: [{
                  value: realTimeMetrics.totalRequests,
                  timeUnixNano: Date.now() * 1000000
                }],
                aggregationTemporality: 1, // Cumulative
                isMonotonic: true
              }
            },
            {
              name: 'ccr.requests.per_minute',
              description: 'Requests per minute',
              unit: '1/min',
              gauge: {
                dataPoints: [{
                  value: realTimeMetrics.requestsPerMinute,
                  timeUnixNano: Date.now() * 1000000
                }]
              }
            },
            {
              name: 'ccr.tokens.per_second',
              description: 'Tokens per second',
              unit: '1/s',
              gauge: {
                dataPoints: [{
                  value: realTimeMetrics.tokensPerSecond,
                  timeUnixNano: Date.now() * 1000000
                }]
              }
            },
            // Latency metrics
            {
              name: 'ccr.latency.average',
              description: 'Average latency in milliseconds',
              unit: 'ms',
              gauge: {
                dataPoints: [{
                  value: realTimeMetrics.averageLatency,
                  timeUnixNano: Date.now() * 1000000
                }]
              }
            },
            {
              name: 'ccr.latency.p95',
              description: 'P95 latency in milliseconds',
              unit: 'ms',
              gauge: {
                dataPoints: [{
                  value: realTimeMetrics.latencyPercentiles.p95,
                  timeUnixNano: Date.now() * 1000000
                }]
              }
            },
            // System health
            {
              name: 'ccr.system.health.score',
              description: 'System health score (0-100)',
              unit: '1',
              gauge: {
                dataPoints: [{
                  value: healthStatus.score,
                  timeUnixNano: Date.now() * 1000000
                }]
              }
            },
            {
              name: 'ccr.system.cpu.usage',
              description: 'CPU usage percentage',
              unit: '1',
              gauge: {
                dataPoints: [{
                  value: healthStatus.cpuUsage / 100,
                  timeUnixNano: Date.now() * 1000000
                }]
              }
            }
          ]
        }]
      }]
    };
  }
}

// Singleton instance
export const prometheusExporter = new PrometheusExporter();
