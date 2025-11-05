import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { formatNumber, formatDuration, formatCost } from "@/lib/utils";
import {
  Activity,
  Zap,
  Users,
  AlertTriangle,
  Clock,
  TrendingUp,
  DollarSign,
  Server,
  Database,
  BarChart3,
  Cpu,
  Globe,
  Shield,
  Loader2
} from "lucide-react";

interface RealTimeMetrics {
  requestsPerMinute: number;
  tokensPerSecond: number;
  inputTPS: number;
  outputTPS: number;
  activeSessions: number;
  totalRequests: number;
  errorRate: number;
  averageLatency: number;
  inputTokensPerMinute: number;
  outputTokensPerMinute: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface ProviderMetrics {
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

interface SessionMetrics {
  sessionId: string;
  startTime: number;
  lastActivity: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}

interface RequestHistory {
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

interface TokenAnalytics {
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

// Metric Card Component
interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  color?: string;
  loading?: boolean;
}

function MetricCard({ title, value, subtitle, icon, trend, color = "default", loading = false }: MetricCardProps) {
  const getColorClasses = () => {
    switch (color) {
      case 'success': return 'bg-green-50 border-green-200 text-green-800';
      case 'warning': return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'error': return 'bg-red-50 border-red-200 text-red-800';
      case 'info': return 'bg-blue-50 border-blue-200 text-blue-800';
      default: return 'bg-white border-gray-200 text-gray-800';
    }
  };

  return (
    <Card className={`relative overflow-hidden transition-all duration-300 hover:shadow-lg ${getColorClasses()} border-2`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : trend ? (
          <div className={`flex items-center text-xs ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            <TrendingUp className={`h-3 w-3 mr-1 ${!trend.isPositive ? 'rotate-180' : ''}`} />
            {trend.value}%
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold mb-1">{value}</div>
        <p className="text-xs opacity-80">{subtitle}</p>
      </CardContent>
      {/* Decorative gradient background */}
      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-white/20 to-transparent rounded-bl-full" />
    </Card>
  );
}

export function MetricsDashboard() {
  const { t } = useTranslation();
  const [realTimeMetrics, setRealTimeMetrics] = useState<RealTimeMetrics | null>(null);
  const [providerMetrics, setProviderMetrics] = useState<ProviderMetrics[]>([]);
  const [sessionMetrics, setSessionMetrics] = useState<SessionMetrics[]>([]);
  const [requestHistory, setRequestHistory] = useState<RequestHistory[]>([]);
  const [tokenAnalytics, setTokenAnalytics] = useState<TokenAnalytics | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'tokens' | 'providers' | 'sessions' | 'history'>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(Date.now());
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [connectionErrors, setConnectionErrors] = useState(0);

  // Thread-safe state update function with improved race condition prevention
  const updateRealTimeMetrics = (newMetrics: RealTimeMetrics) => {
    setRealTimeMetrics(prev => {
      // Prevent race conditions with timestamp check and data validation
      if (newMetrics &&
          newMetrics.totalRequests >= 0 &&
          newMetrics.requestsPerMinute >= 0 &&
          (!prev ||
           newMetrics.totalRequests !== prev.totalRequests ||
           newMetrics.requestsPerMinute !== prev.requestsPerMinute ||
           Math.abs(newMetrics.tokensPerSecond - prev.tokensPerSecond) > 0.1)) {
        setLastUpdateTime(Date.now());
        return newMetrics;
      }
      return prev;
    });
  };

  // High-frequency metrics fetcher with improved error handling and debouncing
  const fetchRealTimeMetrics = async () => {
    // Debounce to prevent excessive requests
    const now = Date.now();
    if (now - lastUpdateTime < 50) { // 50ms minimum interval
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 200); // Increased timeout to 200ms

      const response = await fetch('http://127.0.0.1:3456/api/metrics/realtime', {
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const metrics = await response.json();

        // Validate metrics data before updating
        if (metrics && typeof metrics.totalRequests === 'number') {
          updateRealTimeMetrics(metrics);
          setIsConnected(true);
          setConnectionErrors(0);
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      setConnectionErrors(prev => {
        const newCount = prev + 1;
        if (newCount > 5) {
          setIsConnected(false);
        }
        return newCount;
      });

      // Only log errors occasionally to prevent console spam
      if (connectionErrors % 10 === 0) {
        console.error('Real-time metrics fetch error:', error);
      }
    }
  };

  // Optimized fetch for other metrics
  const fetchSecondaryMetrics = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);

      const [providersRes, sessionsRes, historyRes, tokensRes] = await Promise.all([
        fetch('http://127.0.0.1:3456/api/metrics/providers', { signal: controller.signal }),
        fetch('http://127.0.0.1:3456/api/metrics/sessions', { signal: controller.signal }),
        fetch('http://127.0.0.1:3456/api/metrics/history?limit=50', { signal: controller.signal }),
        fetch('http://127.0.0.1:3456/api/metrics/tokens', { signal: controller.signal })
      ]);

      clearTimeout(timeoutId);

      if (providersRes.ok) {
        const providers = await providersRes.json();
        setProviderMetrics(providers);
      }

      if (sessionsRes.ok) {
        const sessions = await sessionsRes.json();
        setSessionMetrics(sessions);
      }

      if (historyRes.ok) {
        const history = await historyRes.json();
        setRequestHistory(history);
      }

      if (tokensRes.ok) {
        const tokens = await tokensRes.json();
        setTokenAnalytics(tokens);
      }
    } catch (error) {
      console.error('Secondary metrics fetch error:', error);
    }
  };

  // Manual refresh function
  const handleManualRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
    fetchRealTimeMetrics();
    fetchSecondaryMetrics();
  };

  // Generate test data function
  const handleGenerateTestData = async () => {
    try {
      const response = await fetch('http://127.0.0.1:3456/api/metrics/generate-test-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Generated test data:', result);
        // Trigger immediate refresh to show the new data
        setTimeout(() => {
          fetchRealTimeMetrics();
          fetchSecondaryMetrics();
        }, 500);
      }
    } catch (error) {
      console.error('Failed to generate test data:', error);
    }
  };

  useEffect(() => {
    let rafId: number;
    let lastFrameTime = 0;
    const targetFrameTime = 70; // 0.07 seconds = 70ms

    // Fetch initial data
    const initializeData = async () => {
      await fetchRealTimeMetrics();
      await fetchSecondaryMetrics();
      setIsLoading(false);
    };

    initializeData();

    // High-frequency update loop using requestAnimationFrame for smooth updates
    const highFrequencyUpdate = (timestamp: number) => {
      if (timestamp - lastFrameTime >= targetFrameTime) {
        fetchRealTimeMetrics();
        lastFrameTime = timestamp;
      }
      rafId = requestAnimationFrame(highFrequencyUpdate);
    };

    // Start the high-frequency update loop
    rafId = requestAnimationFrame(highFrequencyUpdate);

    // Update secondary metrics less frequently
    const secondaryInterval = setInterval(() => {
      fetchSecondaryMetrics();
    }, 1000); // Update secondary data every 1 second

    // Cleanup function
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      clearInterval(secondaryInterval);
    };
  }, [refreshTrigger, connectionErrors]);

  
  const getStatusColor = (value: number, type: 'latency' | 'errorRate') => {
    if (type === 'latency') {
      if (value < 1000) return 'success';
      if (value < 3000) return 'warning';
      return 'error';
    } else {
      if (value < 1) return 'success';
      if (value < 5) return 'warning';
      return 'error';
    }
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
  };

  if (isLoading && !realTimeMetrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
          <div className="text-xl font-semibold text-gray-700">Initializing Metrics Dashboard...</div>
          <div className="text-sm text-gray-500">Connecting to real-time data stream</div>
        </div>
      </div>
    );
  }

  if (!realTimeMetrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
            <BarChart3 className="h-8 w-8 text-gray-400" />
          </div>
          <div className="text-xl font-semibold text-gray-700">No Metrics Data Available</div>
          <div className="text-sm text-gray-500 text-center max-w-md">
            Start by clicking "Generate Test Data" to populate the dashboard with sample metrics,
            or make actual API requests through the router to see real-time tracking.
          </div>
          <Button
            onClick={handleGenerateTestData}
            variant="outline"
            className="mt-4"
          >
            <Database className="h-4 w-4 mr-2" />
            Generate Test Data
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
              <BarChart3 className="h-10 w-10 text-blue-600" />
              Metrics Dashboard
            </h1>
            <p className="text-gray-600 mt-1">Real-time monitoring and analytics for Claude Code Router</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
              <span className="text-sm font-medium text-gray-700">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleGenerateTestData}
                variant="outline"
                size="sm"
                className="hover:bg-green-50 hover:border-green-300 hover:text-green-700 transition-all duration-200 transform hover:scale-105"
                disabled={isLoading}
              >
                <Database className="h-4 w-4 mr-2" />
                Generate Test Data
              </Button>

              <Button
                onClick={handleManualRefresh}
                variant="outline"
                size="sm"
                className="hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 transform hover:scale-105"
                disabled={isLoading}
              >
                <Activity className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            <div className="flex flex-col items-end gap-1">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse shadow-lg`} />
              <div className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded font-mono">
                {lastUpdateTime ? new Date(lastUpdateTime).toLocaleTimeString() : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Enhanced Tab Navigation */}
        <div className="flex gap-1 p-1 bg-white rounded-lg shadow-sm border border-gray-200">
          {(['overview', 'tokens', 'providers', 'sessions', 'history'] as const).map((tab) => (
            <Button
              key={tab}
              variant={selectedTab === tab ? "default" : "ghost"}
              size="sm"
              onClick={() => setSelectedTab(tab)}
              className={`capitalize transition-all duration-200 ${
                selectedTab === tab
                  ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
                  : 'hover:bg-gray-100'
              }`}
            >
              {tab === 'overview' && <Activity className="h-4 w-4 mr-2" />}
              {tab === 'tokens' && <Database className="h-4 w-4 mr-2" />}
              {tab === 'providers' && <Server className="h-4 w-4 mr-2" />}
              {tab === 'sessions' && <Users className="h-4 w-4 mr-2" />}
              {tab === 'history' && <Clock className="h-4 w-4 mr-2" />}
              {tab}
            </Button>
          ))}
        </div>
      </div>

      {/* Overview Tab - Enhanced Design */}
      {selectedTab === 'overview' && (
        <div className="space-y-6">
          {/* Top Metrics Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <MetricCard
              title="Requests/Min"
              value={formatNumber(realTimeMetrics.requestsPerMinute)}
              subtitle="Real-time request rate"
              icon={<Activity className="h-5 w-5" />}
              color="info"
              loading={isLoading}
            />

            <MetricCard
              title="Tokens/Second"
              value={formatNumber(realTimeMetrics.tokensPerSecond)}
              subtitle="Token processing rate"
              icon={<Zap className="h-5 w-5" />}
              color="success"
              loading={isLoading}
            />

            <MetricCard
              title="Active Sessions"
              value={formatNumber(realTimeMetrics.activeSessions)}
              subtitle="Current active sessions"
              icon={<Users className="h-5 w-5" />}
              color="info"
              loading={isLoading}
            />

            <MetricCard
              title="Error Rate"
              value={`${realTimeMetrics.errorRate.toFixed(1)}%`}
              subtitle="Failed requests percentage"
              icon={<AlertTriangle className="h-5 w-5" />}
              color={getStatusColor(realTimeMetrics.errorRate, 'errorRate')}
              loading={isLoading}
            />
          </div>

          {/* Real-time Token Metrics Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <MetricCard
              title="Input TPS"
              value={formatNumber(realTimeMetrics.inputTPS ?? 0)}
              subtitle="Input tokens per second"
              icon={<TrendingUp className="h-5 w-5" />}
              color="success"
              loading={isLoading}
            />

            <MetricCard
              title="Output TPS"
              value={formatNumber(realTimeMetrics.outputTPS ?? 0)}
              subtitle="Output tokens per second"
              icon={<TrendingUp className="h-5 w-5" />}
              color="warning"
              loading={isLoading}
            />

            <MetricCard
              title="Total TPS"
              value={formatNumber(realTimeMetrics.tokensPerSecond ?? 0)}
              subtitle="Combined tokens per second"
              icon={<Zap className="h-5 w-5" />}
              color="info"
              loading={isLoading}
            />

            <MetricCard
              title="TPS Ratio I/O"
              value={`${((realTimeMetrics.inputTPS ?? 0) / Math.max((realTimeMetrics.outputTPS ?? 0), 1)).toFixed(2)}:1`}
              subtitle="Input to output TPS ratio"
              icon={<Cpu className="h-5 w-5" />}
              color="default"
              loading={isLoading}
            />
          </div>

          {/* Cumulative Token Metrics Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <MetricCard
              title="Input Tokens/Min"
              value={formatNumber(realTimeMetrics.inputTokensPerMinute ?? 0)}
              subtitle="Input token rate per minute"
              icon={<Database className="h-5 w-5" />}
              color="info"
              loading={isLoading}
            />

            <MetricCard
              title="Output Tokens/Min"
              value={formatNumber(realTimeMetrics.outputTokensPerMinute ?? 0)}
              subtitle="Output token rate per minute"
              icon={<Globe className="h-5 w-5" />}
              color="success"
              loading={isLoading}
            />

            <MetricCard
              title="Total Input Tokens"
              value={formatNumber(realTimeMetrics.totalInputTokens ?? 0)}
              subtitle="All-time input tokens"
              icon={<Database className="h-5 w-5" />}
              color="default"
              loading={isLoading}
            />

            <MetricCard
              title="Total Output Tokens"
              value={formatNumber(realTimeMetrics.totalOutputTokens ?? 0)}
              subtitle="All-time output tokens"
              icon={<Globe className="h-5 w-5" />}
              color="default"
              loading={isLoading}
            />
          </div>

          {/* Performance and Cost Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <MetricCard
              title="Average Latency"
              value={formatDuration(realTimeMetrics.averageLatency)}
              subtitle="Average response time"
              icon={<Clock className="h-5 w-5" />}
              color={getStatusColor(realTimeMetrics.averageLatency, 'latency')}
              loading={isLoading}
            />

            <MetricCard
              title="Total Requests"
              value={formatNumber(realTimeMetrics.totalRequests)}
              subtitle="All-time requests"
              icon={<BarChart3 className="h-5 w-5" />}
              color="info"
              loading={isLoading}
            />

            <MetricCard
              title="Total Cost"
              value={tokenAnalytics ? formatCost(tokenAnalytics.totalCost) : '$0.00'}
              subtitle="Estimated API cost"
              icon={<DollarSign className="h-5 w-5" />}
              color="success"
              loading={isLoading}
            />
          </div>
        </div>
      )}

      {/* Tokens Tab - Enhanced */}
      {selectedTab === 'tokens' && tokenAnalytics && (
        <div className="space-y-6">
          {/* Token Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <MetricCard
              title="Total Tokens"
              value={formatNumber(tokenAnalytics.totalTokens)}
              subtitle={`${formatNumber(tokenAnalytics.totalInputTokens)} in / ${formatNumber(tokenAnalytics.totalOutputTokens)} out`}
              icon={<Database className="h-5 w-5" />}
              color="info"
            />

            <MetricCard
              title="Total Cost"
              value={formatCost(tokenAnalytics.totalCost)}
              subtitle="Estimated API cost"
              icon={<DollarSign className="h-5 w-5" />}
              color="success"
            />

            <MetricCard
              title="Avg Tokens/Request"
              value={formatNumber(tokenAnalytics.averageTokensPerRequest)}
              subtitle="Per request average"
              icon={<Cpu className="h-5 w-5" />}
              color="info"
            />

            <MetricCard
              title="Input/Output Ratio"
              value={tokenAnalytics.inputToOutputRatio.toFixed(2)}
              subtitle="Output per input token"
              icon={<TrendingUp className="h-5 w-5" />}
              color="warning"
            />
          </div>

          {/* Detailed Analytics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-lg border-2 border-gray-200">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200">
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5 text-blue-600" />
                  Top Models by Token Usage
                </CardTitle>
                <CardDescription>Models with highest token consumption</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-200">
                  {tokenAnalytics.topModelsByTokens.slice(0, 10).map((model, index) => (
                    <div key={index} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-bold text-blue-600">
                          {index + 1}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">{model.model}</div>
                          <div className="text-sm text-gray-500">{model.provider}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-gray-900">{formatNumber(model.tokens)}</div>
                        <div className="text-sm font-medium text-green-600">{formatCost(model.cost)}</div>
                      </div>
                    </div>
                  ))}
                  {tokenAnalytics.topModelsByTokens.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      <Database className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                      No token usage data available yet
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg border-2 border-gray-200">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-gray-200">
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-green-600" />
                  24-Hour Token Usage
                </CardTitle>
                <CardDescription>Hourly token consumption pattern</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-y-auto">
                  {tokenAnalytics.hourlyTokenUsage.slice(-24).map((hour, index) => (
                    <div key={index} className="flex items-center justify-between p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <div className="font-medium text-gray-900">{hour.hour}:00</div>
                      <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-blue-500" />
                          <span className="font-medium text-blue-600">{formatNumber(hour.inputTokens)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-gray-400">
                          →
                        </div>
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-green-500" />
                          <span className="font-medium text-green-600">{formatNumber(hour.outputTokens)}</span>
                        </div>
                        <div className="font-medium text-green-600 bg-green-50 px-2 py-1 rounded">
                          {formatCost(hour.cost)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {tokenAnalytics.hourlyTokenUsage.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      <Clock className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                      No hourly usage data available yet
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Providers Tab - Enhanced */}
      {selectedTab === 'providers' && (
        <Card className="shadow-lg border-2 border-gray-200">
          <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50 border-b border-gray-200">
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5 text-purple-600" />
              Provider Analytics
            </CardTitle>
            <CardDescription>Detailed usage statistics per LLM provider</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-4 font-semibold text-gray-900">Provider</th>
                    <th className="text-left p-4 font-semibold text-gray-900">Model</th>
                    <th className="text-right p-4 font-semibold text-gray-900">Requests</th>
                    <th className="text-right p-4 font-semibold text-gray-900">Input Tokens</th>
                    <th className="text-right p-4 font-semibold text-gray-900">Output Tokens</th>
                    <th className="text-right p-4 font-semibold text-gray-900">Errors</th>
                    <th className="text-right p-4 font-semibold text-gray-900">Avg Latency</th>
                    <th className="text-right p-4 font-semibold text-gray-900">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {providerMetrics.map((provider, index) => (
                    <tr key={index} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-purple-500" />
                          <span className="font-medium">{provider.provider}</span>
                        </div>
                      </td>
                      <td className="p-4 font-medium">{provider.model}</td>
                      <td className="text-right p-4 font-semibold">{formatNumber(provider.requests)}</td>
                      <td className="text-right p-4">{formatNumber(provider.inputTokens)}</td>
                      <td className="text-right p-4">{formatNumber(provider.outputTokens)}</td>
                      <td className="text-right p-4">
                        {provider.errors > 0 ? (
                          <Badge variant="destructive">{provider.errors}</Badge>
                        ) : (
                          <span className="text-green-600 font-medium">0</span>
                        )}
                      </td>
                      <td className={`text-right p-4 font-medium ${
                        getStatusColor(provider.averageLatency, 'latency') === 'success' ? 'text-green-600' :
                        getStatusColor(provider.averageLatency, 'latency') === 'warning' ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {formatDuration(provider.averageLatency)}
                      </td>
                      <td className="text-right p-4 font-medium text-green-600">
                        {formatCost(provider.totalCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {providerMetrics.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Server className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  No provider metrics available yet
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sessions Tab - Enhanced */}
      {selectedTab === 'sessions' && (
        <Card className="shadow-lg border-2 border-gray-200">
          <CardHeader className="bg-gradient-to-r from-cyan-50 to-blue-50 border-b border-gray-200">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-cyan-600" />
              Active Sessions
            </CardTitle>
            <CardDescription>Currently active Claude Code sessions</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-4 font-semibold text-gray-900">Session ID</th>
                    <th className="text-left p-4 font-semibold text-gray-900">Provider</th>
                    <th className="text-left p-4 font-semibold text-gray-900">Model</th>
                    <th className="text-right p-4 font-semibold text-gray-900">Requests</th>
                    <th className="text-right p-4 font-semibold text-gray-900">Total Tokens</th>
                    <th className="text-left p-4 font-semibold text-gray-900">Duration</th>
                    <th className="text-left p-4 font-semibold text-gray-900">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionMetrics.map((session, index) => (
                    <tr key={index} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-cyan-500" />
                          <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                            {session.sessionId.substring(0, 8)}...
                          </span>
                        </div>
                      </td>
                      <td className="p-4 font-medium">{session.provider}</td>
                      <td className="p-4">{session.model}</td>
                      <td className="text-right p-4 font-semibold">{formatNumber(session.requestCount)}</td>
                      <td className="text-right p-4">
                        {formatNumber(session.inputTokens + session.outputTokens)}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-gray-400" />
                          {formatUptime((Date.now() - session.startTime) / 1000)}
                        </div>
                      </td>
                      <td className="p-4 text-sm text-gray-600">{formatTimestamp(session.lastActivity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sessionMetrics.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Users className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  No active sessions
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* History Tab - Enhanced */}
      {selectedTab === 'history' && (
        <Card className="shadow-lg border-2 border-gray-200">
          <CardHeader className="bg-gradient-to-r from-orange-50 to-red-50 border-b border-gray-200">
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-600" />
              Request History
            </CardTitle>
            <CardDescription>Recent API requests with detailed information</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-4 font-semibold text-gray-900">Time</th>
                    <th className="text-left p-4 font-semibold text-gray-900">Provider</th>
                    <th className="text-left p-4 font-semibold text-gray-900">Model</th>
                    <th className="text-right p-4 font-semibold text-gray-900">Input Tokens</th>
                    <th className="text-right p-4 font-semibold text-gray-900">Output Tokens</th>
                    <th className="text-right p-4 font-semibold text-gray-900">Latency</th>
                    <th className="text-left p-4 font-semibold text-gray-900">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {requestHistory.map((request, index) => (
                    <tr key={index} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-gray-400" />
                          {formatTimestamp(request.timestamp)}
                        </div>
                      </td>
                      <td className="p-4 font-medium">{request.provider}</td>
                      <td className="p-4">{request.model}</td>
                      <td className="text-right p-4">{formatNumber(request.inputTokens)}</td>
                      <td className="text-right p-4">{formatNumber(request.outputTokens)}</td>
                      <td className={`text-right p-4 font-medium ${
                        getStatusColor(request.duration, 'latency') === 'success' ? 'text-green-600' :
                        getStatusColor(request.duration, 'latency') === 'warning' ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {formatDuration(request.duration)}
                      </td>
                      <td className="p-4">
                        {request.success ? (
                          <Badge className="bg-green-100 text-green-800 border-green-200">Success</Badge>
                        ) : (
                          <Badge variant="destructive">Error</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {requestHistory.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Clock className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  No request history available
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}