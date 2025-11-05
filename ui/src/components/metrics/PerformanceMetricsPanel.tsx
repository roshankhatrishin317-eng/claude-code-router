import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, AlertTriangle, CheckCircle, XCircle, Zap } from "lucide-react";
import { EnhancedMetricCard } from './EnhancedMetricCard';
import { formatDuration, formatNumber } from '@/lib/utils';

interface LatencyPercentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  average: number;
  min: number;
  max: number;
}

interface StatusCodeDistribution {
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

interface SystemHealthSummary {
  status: 'healthy' | 'warning' | 'critical';
  cpuUsage: number;
  memoryUsage: number;
  heapUsage: number;
  eventLoopDelay: number;
  score: number;
  issues: string[];
}

interface PerformanceMetricsPanelProps {
  latencyPercentiles: LatencyPercentiles;
  statusCodeDistribution: StatusCodeDistribution;
  systemHealth: SystemHealthSummary;
  loading?: boolean;
}

export function PerformanceMetricsPanel({
  latencyPercentiles,
  statusCodeDistribution,
  systemHealth,
  loading = false,
}: PerformanceMetricsPanelProps) {
  // Calculate total requests
  const totalRequests = 
    statusCodeDistribution['2xx_success'] +
    statusCodeDistribution['3xx_redirect'] +
    statusCodeDistribution['4xx_client_error'] +
    statusCodeDistribution['5xx_server_error'];

  // Calculate success rate
  const successRate = totalRequests > 0
    ? (statusCodeDistribution['2xx_success'] / totalRequests) * 100
    : 100;

  // Get health status color
  const getHealthColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'success';
      case 'warning': return 'warning';
      case 'critical': return 'error';
      default: return 'default';
    }
  };

  // Get latency color based on value
  const getLatencyColor = (latency: number) => {
    if (latency < 500) return 'success';
    if (latency < 1000) return 'info';
    if (latency < 2000) return 'warning';
    return 'error';
  };

  return (
    <div className="space-y-6">
      {/* Latency Percentiles */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-500" />
          Response Time Analysis
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <EnhancedMetricCard
            title="P50 (Median)"
            value={formatDuration(latencyPercentiles.p50)}
            subtitle="50% of requests faster"
            icon={<Clock className="h-4 w-4" />}
            color={getLatencyColor(latencyPercentiles.p50)}
            loading={loading}
            size="sm"
            tooltip="50th percentile: Half of all requests complete faster than this"
          />
          
          <EnhancedMetricCard
            title="P90"
            value={formatDuration(latencyPercentiles.p90)}
            subtitle="90% of requests faster"
            icon={<Clock className="h-4 w-4" />}
            color={getLatencyColor(latencyPercentiles.p90)}
            loading={loading}
            size="sm"
            tooltip="90th percentile: 90% of requests complete faster than this"
          />
          
          <EnhancedMetricCard
            title="P95"
            value={formatDuration(latencyPercentiles.p95)}
            subtitle="95% of requests faster"
            icon={<Clock className="h-4 w-4" />}
            color={getLatencyColor(latencyPercentiles.p95)}
            loading={loading}
            size="sm"
            tooltip="95th percentile: Used for SLA monitoring"
          />
          
          <EnhancedMetricCard
            title="P99"
            value={formatDuration(latencyPercentiles.p99)}
            subtitle="99% of requests faster"
            icon={<Clock className="h-4 w-4" />}
            color={getLatencyColor(latencyPercentiles.p99)}
            loading={loading}
            size="sm"
            tooltip="99th percentile: Outlier detection threshold"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <EnhancedMetricCard
            title="P99.9"
            value={formatDuration(latencyPercentiles.p999)}
            subtitle="99.9% of requests faster"
            icon={<Zap className="h-4 w-4" />}
            color={getLatencyColor(latencyPercentiles.p999)}
            loading={loading}
            size="sm"
          />
          
          <EnhancedMetricCard
            title="Average"
            value={formatDuration(latencyPercentiles.average)}
            subtitle="Mean response time"
            icon={<Activity className="h-4 w-4" />}
            color="info"
            loading={loading}
            size="sm"
          />
          
          <EnhancedMetricCard
            title="Minimum"
            value={formatDuration(latencyPercentiles.min)}
            subtitle="Fastest response"
            icon={<Zap className="h-4 w-4" />}
            color="success"
            loading={loading}
            size="sm"
          />
          
          <EnhancedMetricCard
            title="Maximum"
            value={formatDuration(latencyPercentiles.max)}
            subtitle="Slowest response"
            icon={<AlertTriangle className="h-4 w-4" />}
            color="warning"
            loading={loading}
            size="sm"
          />
        </div>
      </div>

      {/* Status Code Distribution */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Activity className="h-5 w-5 text-purple-500" />
          HTTP Status Code Distribution
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status Code Summary */}
          <Card className="shadow-xl border-2 border-gray-200 dark:border-gray-700 hover:shadow-2xl transition-all">
            <CardHeader className="bg-gradient-to-r from-blue-500 to-purple-500 text-white">
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Status Code Summary
              </CardTitle>
              <CardDescription className="text-blue-50">
                Distribution of HTTP response codes
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                    <span className="font-bold text-green-900 dark:text-green-100">2xx Success</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-green-700 dark:text-green-300">
                      {formatNumber(statusCodeDistribution['2xx_success'])}
                    </span>
                    <Badge variant="default" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                      {((statusCodeDistribution['2xx_success'] / totalRequests) * 100).toFixed(1)}%
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-3">
                    <Activity className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <span className="font-bold text-blue-900 dark:text-blue-100">3xx Redirect</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                      {formatNumber(statusCodeDistribution['3xx_redirect'])}
                    </span>
                    <Badge variant="default" className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      {totalRequests > 0 ? ((statusCodeDistribution['3xx_redirect'] / totalRequests) * 100).toFixed(1) : 0}%
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                    <span className="font-bold text-yellow-900 dark:text-yellow-100">4xx Client Error</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
                      {formatNumber(statusCodeDistribution['4xx_client_error'])}
                    </span>
                    <Badge variant="default" className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                      {totalRequests > 0 ? ((statusCodeDistribution['4xx_client_error'] / totalRequests) * 100).toFixed(1) : 0}%
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
                  <div className="flex items-center gap-3">
                    <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                    <span className="font-bold text-red-900 dark:text-red-100">5xx Server Error</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-red-700 dark:text-red-300">
                      {formatNumber(statusCodeDistribution['5xx_server_error'])}
                    </span>
                    <Badge variant="destructive">
                      {totalRequests > 0 ? ((statusCodeDistribution['5xx_server_error'] / totalRequests) * 100).toFixed(1) : 0}%
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Success rate badge */}
              <div className="mt-6 p-4 bg-gradient-to-r from-green-100 to-emerald-100 dark:from-green-950 dark:to-emerald-950 rounded-lg border-2 border-green-300 dark:border-green-700">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-green-900 dark:text-green-100">Overall Success Rate</span>
                  <span className="text-3xl font-black text-green-700 dark:text-green-300">{successRate.toFixed(2)}%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Detailed Error Types */}
          <Card className="shadow-xl border-2 border-gray-200 dark:border-gray-700 hover:shadow-2xl transition-all">
            <CardHeader className="bg-gradient-to-r from-orange-500 to-red-500 text-white">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Detailed Error Breakdown
              </CardTitle>
              <CardDescription className="text-orange-50">
                Specific error types and counts
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-3">
                {Object.entries(statusCodeDistribution.errorTypes).map(([errorType, count]) => {
                  const label = errorType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                  const percentage = totalRequests > 0 ? (count / totalRequests) * 100 : 0;
                  
                  return (
                    <div key={errorType} className="group">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
                        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{count}</span>
                      </div>
                      <div className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 rounded-full ${
                            count > 0 ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                          style={{ width: `${Math.min(percentage * 10, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* System Health */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-500" />
          System Health & Resources
        </h3>

        <Card className={`shadow-xl border-2 transition-all ${
          systemHealth.status === 'healthy' ? 'border-green-300 dark:border-green-700' :
          systemHealth.status === 'warning' ? 'border-yellow-300 dark:border-yellow-700' :
          'border-red-300 dark:border-red-700'
        }`}>
          <CardHeader className={`bg-gradient-to-r ${
            systemHealth.status === 'healthy' ? 'from-green-500 to-emerald-500' :
            systemHealth.status === 'warning' ? 'from-yellow-500 to-orange-500' :
            'from-red-500 to-pink-500'
          } text-white`}>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                {systemHealth.status === 'healthy' ? <CheckCircle className="h-5 w-5" /> :
                 systemHealth.status === 'warning' ? <AlertTriangle className="h-5 w-5" /> :
                 <XCircle className="h-5 w-5" />}
                System Health: {systemHealth.status.toUpperCase()}
              </CardTitle>
              <Badge className="bg-white/20 text-white border-white/40 text-lg font-bold px-4 py-1">
                Score: {systemHealth.score}/100
              </Badge>
            </div>
            <CardDescription className={
              systemHealth.status === 'healthy' ? 'text-green-50' :
              systemHealth.status === 'warning' ? 'text-yellow-50' :
              'text-red-50'
            }>
              Real-time monitoring of system resources
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* CPU Usage */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">CPU Usage</span>
                  <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {systemHealth.cpuUsage.toFixed(1)}%
                  </span>
                </div>
                <div className="relative h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      systemHealth.cpuUsage < 50 ? 'bg-green-500' :
                      systemHealth.cpuUsage < 80 ? 'bg-yellow-500' :
                      'bg-red-500'
                    }`}
                    style={{ width: `${systemHealth.cpuUsage}%` }}
                  />
                </div>
              </div>

              {/* Memory Usage */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">Memory Usage</span>
                  <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {systemHealth.memoryUsage.toFixed(1)}%
                  </span>
                </div>
                <div className="relative h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      systemHealth.memoryUsage < 50 ? 'bg-green-500' :
                      systemHealth.memoryUsage < 80 ? 'bg-yellow-500' :
                      'bg-red-500'
                    }`}
                    style={{ width: `${systemHealth.memoryUsage}%` }}
                  />
                </div>
              </div>

              {/* Heap Usage */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">Heap Usage</span>
                  <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {systemHealth.heapUsage.toFixed(1)}%
                  </span>
                </div>
                <div className="relative h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      systemHealth.heapUsage < 50 ? 'bg-green-500' :
                      systemHealth.heapUsage < 80 ? 'bg-yellow-500' :
                      'bg-red-500'
                    }`}
                    style={{ width: `${systemHealth.heapUsage}%` }}
                  />
                </div>
              </div>

              {/* Event Loop Delay */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">Event Loop Delay</span>
                  <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {systemHealth.eventLoopDelay.toFixed(2)}ms
                  </span>
                </div>
                <div className="relative h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      systemHealth.eventLoopDelay < 10 ? 'bg-green-500' :
                      systemHealth.eventLoopDelay < 50 ? 'bg-yellow-500' :
                      'bg-red-500'
                    }`}
                    style={{ width: `${Math.min((systemHealth.eventLoopDelay / 100) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Health Issues */}
            {systemHealth.issues && systemHealth.issues.length > 0 && (
              <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-950 border-2 border-yellow-300 dark:border-yellow-700 rounded-lg">
                <h4 className="text-sm font-bold text-yellow-900 dark:text-yellow-100 mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Health Issues Detected
                </h4>
                <ul className="space-y-1">
                  {systemHealth.issues.map((issue, index) => (
                    <li key={index} className="text-sm text-yellow-800 dark:text-yellow-200 flex items-start gap-2">
                      <span className="text-yellow-600 dark:text-yellow-400 mt-0.5">•</span>
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
