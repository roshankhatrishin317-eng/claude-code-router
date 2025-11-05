/**
 * Advanced Alerting System
 *
 * This module provides comprehensive alerting capabilities with threshold-based
 * notifications for email, Slack, webhooks, and other channels.
 */

import { EventEmitter } from 'events';
import { metricsCollector } from './metrics';
import { systemHealthMonitor } from './systemHealth';
import { circuitBreakerManager } from './circuitBreaker';

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  severity: 'info' | 'warning' | 'critical';
  metric: AlertMetric;
  condition: AlertCondition;
  duration: number; // milliseconds - how long condition must persist
  channels: AlertChannel[];
  cooldown: number; // milliseconds - minimum time between alerts
  lastTriggered?: number;
  tags?: Record<string, string>;
}

export interface AlertMetric {
  type: 'metric' | 'composite' | 'system';
  name: string;
  source: 'metrics' | 'health' | 'circuit_breaker';
  labels?: Record<string, string>;
}

export interface AlertCondition {
  operator: 'gt' | 'lt' | 'eq' | 'ne' | 'gte' | 'lte';
  threshold: number;
}

export interface AlertChannel {
  type: 'email' | 'slack' | 'webhook' | 'console' | 'sms';
  config: Record<string, any>;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  timestamp: number;
  value: number;
  threshold: number;
  metric: string;
  tags?: Record<string, string>;
  resolved?: boolean;
  resolvedAt?: number;
}

export class AlertingManager extends EventEmitter {
  private rules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private alertHistory: Alert[] = [];
  private evaluationState: Map<string, {
    startTime?: number;
    conditionMet: boolean;
    consecutiveBreaches: number;
  }> = new Map();

  constructor() {
    super();
    this.initializeDefaultRules();
    this.startEvaluation();
  }

  /**
   * Create a new alert rule
   */
  createRule(rule: Omit<AlertRule, 'id'>): AlertRule {
    const id = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullRule: AlertRule = {
      ...rule,
      id
    };

    this.rules.set(id, fullRule);
    console.log(`Created alert rule: ${rule.name} (${id})`);

    return fullRule;
  }

  /**
   * Update an existing alert rule
   */
  updateRule(id: string, updates: Partial<AlertRule>): boolean {
    const existingRule = this.rules.get(id);
    if (!existingRule) {
      return false;
    }

    const updatedRule = { ...existingRule, ...updates };
    this.rules.set(id, updatedRule);

    return true;
  }

  /**
   * Delete an alert rule
   */
  deleteRule(id: string): boolean {
    const deleted = this.rules.delete(id);
    if (deleted) {
      // Clean up evaluation state
      this.evaluationState.delete(id);

      // Resolve any active alerts for this rule
      for (const [alertId, alert] of this.activeAlerts.entries()) {
        if (alert.ruleId === id) {
          this.resolveAlert(alertId, 'Rule deleted');
        }
      }
    }

    return deleted;
  }

  /**
   * Get all alert rules
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit: number = 100): Alert[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Resolve an active alert
   */
  resolveAlert(alertId: string, reason?: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return;

    alert.resolved = true;
    alert.resolvedAt = Date.now();

    this.activeAlerts.delete(alertId);

    console.log(`Alert resolved: ${alert.title} (${reason || 'Manual resolution'})`);
    this.emit('alertResolved', alert);
  }

  /**
   * Manually trigger an alert (for testing)
   */
  triggerAlert(rule: AlertRule, value: number): void {
    this.createAndSendAlert(rule, value);
  }

  /**
   * Start alert evaluation loop
   */
  private startEvaluation(): void {
    setInterval(() => {
      this.evaluateRules();
    }, 30000); // Every 30 seconds
  }

  /**
   * Evaluate all alert rules
   */
  private evaluateRules(): void {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      try {
        this.evaluateRule(rule);
      } catch (error) {
        console.error(`Error evaluating rule ${rule.name}:`, error);
      }
    }
  }

  /**
   * Evaluate a single rule
   */
  private evaluateRule(rule: AlertRule): void {
    const currentValue = this.getMetricValue(rule.metric);
    const conditionMet = this.evaluateCondition(currentValue, rule.condition);

    const state = this.evaluationState.get(rule.id) || {
      conditionMet: false,
      consecutiveBreaches: 0
    };

    // Update consecutive breach count
    if (conditionMet) {
      if (!state.conditionMet) {
        state.consecutiveBreaches = 1;
      } else {
        state.consecutiveBreaches++;
      }

      // Check if we should trigger the alert
      if (this.shouldTriggerAlert(rule, state, currentValue)) {
        this.createAndSendAlert(rule, currentValue);
      }
    } else {
      state.consecutiveBreaches = 0;
    }

    state.conditionMet = conditionMet;
    this.evaluationState.set(rule.id, state);
  }

  /**
   * Get current value of a metric
   */
  private getMetricValue(metric: AlertMetric): number {
    switch (metric.source) {
      case 'metrics':
        return this.getMetricsValue(metric);
      case 'health':
        return this.getHealthValue(metric);
      case 'circuit_breaker':
        return this.getCircuitBreakerValue(metric);
      default:
        return 0;
    }
  }

  /**
   * Get value from metrics collector
   */
  private getMetricsValue(metric: AlertMetric): number {
    const realTimeMetrics = metricsCollector.getRealTimeMetrics();

    switch (metric.name) {
      case 'error_rate':
        return realTimeMetrics.errorRate;
      case 'average_latency':
        return realTimeMetrics.averageLatency;
      case 'requests_per_minute':
        return realTimeMetrics.requestsPerMinute;
      case 'tokens_per_second':
        return realTimeMetrics.tokensPerSecond;
      case 'active_sessions':
        return realTimeMetrics.activeSessions;
      default:
        return 0;
    }
  }

  /**
   * Get value from system health
   */
  private getHealthValue(metric: AlertMetric): number {
    const healthStatus = systemHealthMonitor.getHealthStatus();

    switch (metric.name) {
      case 'health_score':
        return healthStatus.score;
      case 'cpu_usage':
        return healthStatus.cpuUsage;
      case 'memory_usage':
        return healthStatus.memoryUsage;
      case 'heap_usage':
        return healthStatus.heapUsage;
      case 'event_loop_delay':
        return healthStatus.eventLoopDelay;
      default:
        return 0;
    }
  }

  /**
   * Get value from circuit breaker
   */
  private getCircuitBreakerValue(metric: AlertMetric): number {
    const cbStatus = circuitBreakerManager.getHealthSummary();

    switch (metric.name) {
      case 'unhealthy_providers':
        return cbStatus.unhealthy;
      case 'total_providers':
        return cbStatus.total;
      case 'open_circuits':
        return cbStatus.byState.OPEN || 0;
      default:
        return 0;
    }
  }

  /**
   * Evaluate condition against threshold
   */
  private evaluateCondition(value: number, condition: AlertCondition): boolean {
    switch (condition.operator) {
      case 'gt':
        return value > condition.threshold;
      case 'gte':
        return value >= condition.threshold;
      case 'lt':
        return value < condition.threshold;
      case 'lte':
        return value <= condition.threshold;
      case 'eq':
        return value === condition.threshold;
      case 'ne':
        return value !== condition.threshold;
      default:
        return false;
    }
  }

  /**
   * Check if alert should be triggered
   */
  private shouldTriggerAlert(rule: AlertRule, state: any, value: number): boolean {
    const now = Date.now();

    // Check if cooldown period has passed
    if (rule.lastTriggered && now - rule.lastTriggered < rule.cooldown) {
      return false;
    }

    // Check if condition has persisted long enough
    if (state.consecutiveBreaches * 30000 < rule.duration) { // 30 seconds per evaluation
      return false;
    }

    return true;
  }

  /**
   * Create and send alert
   */
  private createAndSendAlert(rule: AlertRule, value: number): void {
    const alert: Alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      title: this.generateAlertTitle(rule, value),
      message: this.generateAlertMessage(rule, value),
      timestamp: Date.now(),
      value,
      threshold: rule.condition.threshold,
      metric: rule.metric.name,
      tags: rule.tags
    };

    // Store active alert
    this.activeAlerts.set(alert.id, alert);
    this.alertHistory.push(alert);

    // Update rule
    rule.lastTriggered = alert.timestamp;

    // Send to all channels
    this.sendAlert(alert, rule.channels);

    console.log(`Alert triggered: ${alert.title} (${alert.message})`);
    this.emit('alertTriggered', alert);
  }

  /**
   * Send alert to configured channels
   */
  private sendAlert(alert: Alert, channels: AlertChannel[]): void {
    channels.forEach(channel => {
      try {
        switch (channel.type) {
          case 'console':
            this.sendToConsole(alert);
            break;
          case 'email':
            this.sendToEmail(alert, channel.config);
            break;
          case 'slack':
            this.sendToSlack(alert, channel.config);
            break;
          case 'webhook':
            this.sendToWebhook(alert, channel.config);
            break;
          default:
            console.warn(`Unknown alert channel type: ${channel.type}`);
        }
      } catch (error) {
        console.error(`Failed to send alert to ${channel.type}:`, error);
      }
    });
  }

  /**
   * Send alert to console
   */
  private sendToConsole(alert: Alert): void {
    const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${emoji} [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`);
  }

  /**
   * Send alert to email (placeholder - would integrate with email service)
   */
  private sendToEmail(alert: Alert, config: Record<string, any>): void {
    console.log(`[EMAIL] Alert would be sent to ${config.to || 'admin@example.com'}: ${alert.title}`);
    // In production, integrate with SendGrid, AWS SES, etc.
  }

  /**
   * Send alert to Slack
   */
  private sendToSlack(alert: Alert, config: Record<string, any>): void {
    console.log(`[SLACK] Alert would be sent to webhook: ${alert.title}`);
    // In production, integrate with Slack Web API
  }

  /**
   * Send alert to webhook
   */
  private sendToWebhook(alert: Alert, config: Record<string, any>): void {
    console.log(`[WEBHOOK] Alert would be sent to ${config.url}: ${JSON.stringify(alert)}`);
    // In production, make HTTP request to webhook URL
  }

  /**
   * Generate alert title
   */
  private generateAlertTitle(rule: AlertRule, value: number): string {
    const severity = rule.severity.toUpperCase();
    return `${severity}: ${rule.name}`;
  }

  /**
   * Generate alert message
   */
  private generateAlertMessage(rule: AlertRule, value: number): string {
    return `${rule.metric.name} is ${value} (threshold: ${rule.condition.operator} ${rule.condition.threshold})`;
  }

  /**
   * Initialize default alert rules
   */
  private initializeDefaultRules(): void {
    // High error rate alert
    this.createRule({
      name: 'High Error Rate',
      description: 'Triggered when error rate exceeds 10% for 5 minutes',
      enabled: true,
      severity: 'critical',
      metric: { type: 'metric', name: 'error_rate', source: 'metrics' },
      condition: { operator: 'gt', threshold: 10 },
      duration: 5 * 60 * 1000, // 5 minutes
      channels: [{ type: 'console', config: {} }],
      cooldown: 15 * 60 * 1000, // 15 minutes
      tags: { category: 'reliability' }
    });

    // High latency alert
    this.createRule({
      name: 'High Latency',
      description: 'Triggered when average latency exceeds 5 seconds for 10 minutes',
      enabled: true,
      severity: 'warning',
      metric: { type: 'metric', name: 'average_latency', source: 'metrics' },
      condition: { operator: 'gt', threshold: 5000 },
      duration: 10 * 60 * 1000, // 10 minutes
      channels: [{ type: 'console', config: {} }],
      cooldown: 30 * 60 * 1000, // 30 minutes
      tags: { category: 'performance' }
    });

    // System health critical
    this.createRule({
      name: 'System Health Critical',
      description: 'Triggered when system health score drops below 50',
      enabled: true,
      severity: 'critical',
      metric: { type: 'system', name: 'health_score', source: 'health' },
      condition: { operator: 'lt', threshold: 50 },
      duration: 2 * 60 * 1000, // 2 minutes
      channels: [{ type: 'console', config: {} }],
      cooldown: 10 * 60 * 1000, // 10 minutes
      tags: { category: 'system' }
    });

    // Unhealthy providers
    this.createRule({
      name: 'Providers Unhealthy',
      description: 'Triggered when more than 50% of providers are unhealthy',
      enabled: true,
      severity: 'critical',
      metric: { type: 'composite', name: 'unhealthy_providers', source: 'circuit_breaker' },
      condition: { operator: 'gt', threshold: 0 },
      duration: 5 * 60 * 1000, // 5 minutes
      channels: [{ type: 'console', config: {} }],
      cooldown: 15 * 60 * 1000, // 15 minutes
      tags: { category: 'availability' }
    });
  }

  /**
   * Get alerting statistics
   */
  getStatistics(): {
    totalRules: number;
    enabledRules: number;
    activeAlerts: number;
    totalAlerts: number;
    recentAlerts: Alert[];
    rulesBySeverity: Record<string, number>;
  } {
    const rules = this.getRules();
    const activeAlerts = this.getActiveAlerts();
    const recentAlerts = this.getAlertHistory(10);

    const rulesBySeverity = rules.reduce((acc, rule) => {
      acc[rule.severity] = (acc[rule.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalRules: rules.length,
      enabledRules: rules.filter(r => r.enabled).length,
      activeAlerts: activeAlerts.length,
      totalAlerts: this.alertHistory.length,
      recentAlerts,
      rulesBySeverity
    };
  }
}

// Singleton instance
export const alertingManager = new AlertingManager();
