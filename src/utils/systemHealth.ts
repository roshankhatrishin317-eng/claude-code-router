/**
 * System Health Monitoring Module
 *
 * This module provides comprehensive system health monitoring including:
 * - CPU usage and load average
 * - Memory usage and heap statistics
 * - Event loop delay
 * - Garbage collection statistics
 * - Process metrics
 */

import { EventEmitter } from 'events';
import * as os from 'os';

export interface CPUInfo {
  usage: number; // 0-100%
  loadAverage: number[]; // 1, 5, 15 minute averages
  coreCount: number;
}

export interface MemoryInfo {
  used: number; // bytes
  total: number; // bytes
  free: number; // bytes
  usagePercent: number; // 0-100
}

export interface HeapInfo {
  used: number; // bytes
  total: number; // bytes
  usagePercent: number; // 0-100
  external: number; // bytes
}

export interface EventLoopInfo {
  delay: number; // milliseconds
  utilization: number; // 0-1 (1 = fully utilized)
}

export interface GCInfo {
  count: number;
  totalTime: number; // milliseconds
  types: {
    'major': number;
    'minor': number;
  };
}

export interface SystemHealth {
  timestamp: number;
  cpu: CPUInfo;
  memory: MemoryInfo;
  heap: HeapInfo;
  eventLoop: EventLoopInfo;
  gc: GCInfo;
  uptime: number;
  process: {
    pid: number;
    memoryRSS: number; // Resident Set Size
    cpuUsage: number; // Process CPU %
    handleCount: number; // Open handles
  };
}

export class SystemHealthMonitor extends EventEmitter {
  private isMonitoring: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private eventLoopMonitor: NodeJS.Timeout | null = null;
  private lastEventLoopCheck: number = Date.now();
  private eventLoopSamples: number[] = [];

  /**
   * Start system health monitoring
   * @param intervalMs - Monitoring interval in milliseconds (default: 1000)
   */
  startMonitoring(intervalMs: number = 1000): void {
    if (this.isMonitoring) {
      console.warn('System health monitoring is already running');
      return;
    }

    this.isMonitoring = true;

    // Monitor system metrics every interval
    this.monitoringInterval = setInterval(() => {
      const health = this.getSystemHealth();
      this.emit('healthUpdate', health);
    }, intervalMs);

    // Monitor event loop delay every 100ms
    this.startEventLoopMonitoring();

    console.log('System health monitoring started');
  }

  /**
   * Stop system health monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.eventLoopMonitor) {
      clearInterval(this.eventLoopMonitor);
      this.eventLoopMonitor = null;
    }

    console.log('System health monitoring stopped');
  }

  /**
   * Get current system health snapshot
   */
  getSystemHealth(): SystemHealth {
    const timestamp = Date.now();
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      timestamp,
      cpu: this.getCPUInfo(),
      memory: this.getMemoryInfo(),
      heap: this.getHeapInfo(memUsage),
      eventLoop: this.getEventLoopInfo(),
      gc: this.getGCInfo(),
      uptime: process.uptime(),
      process: {
        pid: process.pid,
        memoryRSS: memUsage.rss,
        cpuUsage: this.calculateCPUPercent(cpuUsage),
        handleCount: this.getHandleCount()
      }
    };
  }

  /**
   * Get health status as a simple object for quick checks
   */
  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    score: number; // 0-100
  } {
    const health = this.getSystemHealth();
    const issues: string[] = [];
    let score = 100;

    // CPU checks
    if (health.cpu.usage > 90) {
      issues.push('CPU usage critical (>90%)');
      score -= 30;
    } else if (health.cpu.usage > 75) {
      issues.push('CPU usage high (>75%)');
      score -= 15;
    }

    // Memory checks
    if (health.memory.usagePercent > 90) {
      issues.push('Memory usage critical (>90%)');
      score -= 30;
    } else if (health.memory.usagePercent > 80) {
      issues.push('Memory usage high (>80%)');
      score -= 15;
    }

    // Heap checks
    if (health.heap.usagePercent > 90) {
      issues.push('Heap usage critical (>90%)');
      score -= 25;
    } else if (health.heap.usagePercent > 80) {
      issues.push('Heap usage high (>80%)');
      score -= 10;
    }

    // Event loop checks
    if (health.eventLoop.delay > 100) {
      issues.push('Event loop delay critical (>100ms)');
      score -= 20;
    } else if (health.eventLoop.delay > 50) {
      issues.push('Event loop delay high (>50ms)');
      score -= 10;
    }

    // Determine status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (score < 50 || issues.some(i => i.includes('critical'))) {
      status = 'critical';
    } else if (score < 80 || issues.length > 2) {
      status = 'warning';
    }

    return { status, issues, score: Math.max(0, score) };
  }

  private getCPUInfo(): CPUInfo {
    const loadAvg = os.loadavg();
    const cpus = os.cpus();

    return {
      usage: this.calculateCPUUsage(),
      loadAverage: loadAvg,
      coreCount: cpus.length
    };
  }

  private getMemoryInfo(): MemoryInfo {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
      used: usedMem,
      total: totalMem,
      free: freeMem,
      usagePercent: Math.round((usedMem / totalMem) * 100)
    };
  }

  private getHeapInfo(memUsage: any): HeapInfo {
    const used = memUsage.heapUsed;
    const total = memUsage.heapTotal;

    return {
      used,
      total,
      usagePercent: Math.round((used / total) * 100),
      external: memUsage.external
    };
  }

  private getEventLoopInfo(): EventLoopInfo {
    const recentSamples = this.eventLoopSamples.slice(-10); // Last 10 samples
    const avgDelay = recentSamples.length > 0
      ? recentSamples.reduce((sum, delay) => sum + delay, 0) / recentSamples.length
      : 0;

    // Event loop utilization: 0 = idle, 1 = fully utilized
    const utilization = Math.min(1, avgDelay / 16.67); // 16.67ms = 60fps

    return {
      delay: Math.round(avgDelay),
      utilization: Math.round(utilization * 1000) / 1000
    };
  }

  private getGCInfo(): GCInfo {
    // Note: In a production environment, you'd want to use v8's performance hooks
    // For now, we'll provide estimated GC information
    return {
      count: 0, // Would need performance hooks to track accurately
      totalTime: 0,
      types: {
        major: 0,
        minor: 0
      }
    };
  }

  private calculateCPUUsage(): number {
    // Simple CPU usage calculation based on load average
    const loadAvg = os.loadavg()[0];
    const cpuCount = os.cpus().length;

    // Calculate CPU usage percentage based on load average
    const usage = (loadAvg / cpuCount) * 100;

    return Math.min(100, Math.round(usage));
  }

  private calculateCPUPercent(cpuUsage: any): number {
    // This is a simplified CPU calculation
    // In production, you'd want to track this over time
    return 0;
  }

  private getHandleCount(): number {
    try {
      // @ts-ignore - _handleCount is internal but useful for debugging
      return (process as any)._handleCount || 0;
    } catch {
      return 0;
    }
  }

  private startEventLoopMonitoring(): void {
    this.eventLoopMonitor = setInterval(() => {
      const now = Date.now();
      const delay = now - this.lastEventLoopCheck - 100; // Expected interval is 100ms
      this.lastEventLoopCheck = now;

      // Store sample and keep last 100 samples
      this.eventLoopSamples.push(Math.max(0, delay));
      if (this.eventLoopSamples.length > 100) {
        this.eventLoopSamples.shift();
      }
    }, 100);
  }

  /**
   * Get detailed system information for debugging
   */
  getSystemInfo(): {
    platform: string;
    arch: string;
    nodeVersion: string;
    cpuModel: string;
    totalMemory: number;
    cpuCount: number;
  } {
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpuModel: os.cpus()[0].model,
      totalMemory: os.totalmem(),
      cpuCount: os.cpus().length
    };
  }
}

// Singleton instance
export const systemHealthMonitor = new SystemHealthMonitor();
