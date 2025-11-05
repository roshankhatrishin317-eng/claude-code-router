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
  Loader2,
  Sparkles,
  TrendingDown,
  RefreshCw
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
      case 'success': 
        return 'bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 border-emerald-200/50 text-emerald-900 shadow-emerald-100/50';
      case 'warning': 
        return 'bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 border-amber-200/50 text-amber-900 shadow-amber-100/50';
      case 'error': 
        return 'bg-gradient-to-br from-rose-50 via-red-50 to-pink-50 border-rose-200/50 text-rose-900 shadow-rose-100/50';
      case 'info': 
        return 'bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 border-sky-200/50 text-sky-900 shadow-sky-100/50';
      default: 
        return 'bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-50 border-slate-200/50 text-slate-900 shadow-slate-100/50';
    }
  };

  const getIconColorClasses = () => {
    switch (color) {
      case 'success': return 'text-emerald-600 bg-emerald-100/80';
      case 'warning': return 'text-amber-600 bg-amber-100/80';
      case 'error': return 'text-rose-600 bg-rose-100/80';
      case 'info': return 'text-sky-600 bg-sky-100/80';
      default: return 'text-slate-600 bg-slate-100/80';
    }
  };

  return (
    <Card className={`group relative overflow-hidden transition-all duration-500 hover:shadow-2xl hover:scale-[1.02] hover:-translate-y-1 ${getColorClasses()} border backdrop-blur-sm animate-fade-in`}>
      {/* Animated gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      
      {/* Shimmer effect */}
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      
      <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${getIconColorClasses()} transition-all duration-300 group-hover:scale-110 group-hover:rotate-6 shadow-lg`}>
            {icon}
          </div>
          <CardTitle className="text-sm font-semibold tracking-tight">
            {title}
          </CardTitle>
        </div>
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <span className="text-xs text-blue-600 font-medium">Loading</span>
          </div>
        ) : trend ? (
          <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
            trend.isPositive 
              ? 'bg-green-100 text-green-700 border border-green-200' 
              : 'bg-red-100 text-red-700 border border-red-200'
          }`}>
            {trend.isPositive ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {trend.value}%
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="relative">
        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 w-24 rounded-md bg-gray-300/60" />
            <div className="h-3 w-40 rounded-md bg-gray-200/60" />
          </div>
        ) : (
          <>
            <div className="text-3xl font-bold mb-2 tracking-tight bg-gradient-to-br from-gray-900 to-gray-600 bg-clip-text text-transparent">
              {value}
            </div>
            <p className="text-xs opacity-70 font-medium">{subtitle}</p>
          </>
        )}
      </CardContent>
      
      {/* Decorative gradient orbs */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-gradient-to-br from-white/30 to-transparent rounded-full blur-2xl opacity-50 group-hover:opacity-70 transition-opacity duration-500" />
      <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-gradient-to-tr from-white/20 to-transparent rounded-full blur-2xl opacity-30 group-hover:opacity-50 transition-opacity duration-500" />
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
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable');
  const cellPadding = density === 'compact' ? 'p-2' : 'p-4';
  const headerPadding = density === 'compact' ? 'p-2' : 'p-4';

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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40 dark:from-slate-950 dark:via-blue-950/30 dark:to-indigo-950/40 flex items-center justify-center relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-20 w-72 h-72 bg-blue-400/20 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-indigo-400/20 rounded-full blur-3xl animate-pulse" />
        </div>
        
        <div className="relative flex flex-col items-center space-y-8 p-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl rounded-3xl shadow-2xl border border-blue-200/50 dark:border-blue-800/50 animate-scale-in max-w-md">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full blur-2xl opacity-30 animate-pulse" />
            <div className="relative w-24 h-24 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center shadow-2xl shadow-blue-500/50 animate-float">
              <Loader2 className="h-12 w-12 animate-spin text-white" />
            </div>
          </div>
          <div className="text-3xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent text-center">
            Initializing Metrics Dashboard
          </div>
          <div className="text-base text-gray-600 dark:text-gray-400 font-medium text-center">
            Establishing secure connection to real-time data stream...
          </div>
          <div className="flex gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!realTimeMetrics) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40 dark:from-slate-950 dark:via-blue-950/30 dark:to-indigo-950/40 flex items-center justify-center relative overflow-hidden">
        {/* Animated background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-400/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '1.5s' }} />
        </div>
        
        <div className="relative flex flex-col items-center space-y-8 p-14 bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-800/50 max-w-2xl animate-fade-in">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-gray-300 to-gray-400 rounded-full blur-3xl opacity-20 animate-pulse" />
            <div className="relative w-28 h-28 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 rounded-2xl flex items-center justify-center shadow-2xl border border-gray-300 dark:border-gray-600 animate-float">
              <BarChart3 className="h-14 w-14 text-gray-600 dark:text-gray-300" />
            </div>
          </div>
          <div className="text-4xl font-bold bg-gradient-to-r from-gray-700 via-gray-800 to-gray-900 dark:from-gray-200 dark:via-gray-300 dark:to-gray-100 bg-clip-text text-transparent text-center">
            No Metrics Data Available
          </div>
          <div className="text-base text-gray-600 dark:text-gray-400 text-center font-medium leading-relaxed max-w-md">
            Start by clicking <span className="font-bold text-green-600 dark:text-green-400">"Generate Test Data"</span> to populate the dashboard with sample metrics,
            or make actual API requests through the router to see real-time tracking.
          </div>
          <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
            <Button
              onClick={handleGenerateTestData}
              className="relative group bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 hover:from-green-600 hover:via-emerald-600 hover:to-teal-600 text-white shadow-xl shadow-green-500/30 hover:shadow-2xl hover:shadow-green-500/40 hover:scale-105 transition-all duration-300 font-bold px-8 py-6 text-lg rounded-xl overflow-hidden"
            >
              <span className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              <Database className="h-5 w-5 mr-2 relative z-10" />
              <span className="relative z-10">Generate Test Data</span>
            </Button>
            <Button
              onClick={() => setRefreshTrigger(prev => prev + 1)}
              variant="outline"
              className="font-bold px-8 py-6 text-lg rounded-xl border-2 border-gray-300 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-all duration-300 hover:scale-105"
            >
              <RefreshCw className="h-5 w-5 mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40 dark:from-slate-950 dark:via-blue-950/30 dark:to-indigo-950/40 p-6">
      {/* Enhanced Animated background patterns */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gradient-to-br from-blue-400/10 to-cyan-400/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-gradient-to-br from-purple-400/10 to-pink-400/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-gradient-to-br from-indigo-400/10 to-violet-400/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/4 right-1/3 w-72 h-72 bg-gradient-to-br from-emerald-400/10 to-teal-400/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '1.5s' }} />
      </div>
      
      {/* Enhanced Header */}
      <div className="relative mb-10">
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-3">
            <h1 className="text-6xl font-black bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 dark:from-blue-400 dark:via-indigo-400 dark:to-purple-400 bg-clip-text text-transparent flex items-center gap-5 animate-fade-in drop-shadow-lg">
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl blur-xl opacity-60 group-hover:opacity-80 transition-opacity duration-300 animate-pulse" />
                <div className="relative p-4 bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-600 rounded-2xl shadow-2xl shadow-blue-500/40 animate-scale-in hover:scale-110 transition-transform duration-300">
                  <BarChart3 className="h-11 w-11 text-white" />
                </div>
              </div>
              Metrics Dashboard
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg font-semibold flex items-center gap-3 ml-2 animate-fade-in" style={{ animationDelay: '0.1s' }}>
              <div className="flex items-center gap-2 bg-yellow-100 dark:bg-yellow-900/30 px-3 py-1 rounded-full">
                <Sparkles className="h-4 w-4 text-yellow-600 dark:text-yellow-400 animate-pulse" />
                <span className="text-yellow-700 dark:text-yellow-300 text-sm font-bold">LIVE</span>
              </div>
              Real-time monitoring and analytics for Claude Code Router
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md px-5 py-3 rounded-full shadow-xl border-2 border-gray-200/80 dark:border-gray-700/80 hover:shadow-2xl transition-all duration-300 hover:scale-105">
              <div className="relative">
                <div className={`w-4 h-4 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse shadow-lg`} />
                <div className={`absolute inset-0 w-4 h-4 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'} animate-ping opacity-75`} />
              </div>
              <span className={`text-base font-black ${isConnected ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {isConnected ? '● LIVE' : '● OFFLINE'}
              </span>
              <div className="flex flex-col items-end">
                <span className="text-xs text-gray-500 dark:text-gray-400 font-semibold">
                  {new Date().toLocaleTimeString()}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border-2 border-gray-200/80 dark:border-gray-700/80 p-1.5 shadow-xl hover:shadow-2xl transition-all duration-300">
                <div className="flex items-center gap-1.5 p-1">
                  <Button size="sm" variant={density === 'comfortable' ? 'default' : 'ghost'} onClick={() => setDensity('comfortable')} className={`font-bold transition-all duration-300 ${density === 'comfortable' ? 'bg-gradient-to-r from-slate-700 to-slate-900 text-white shadow-lg' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>Comfort</Button>
                  <Button size="sm" variant={density === 'compact' ? 'default' : 'ghost'} onClick={() => setDensity('compact')} className={`font-bold transition-all duration-300 ${density === 'compact' ? 'bg-gradient-to-r from-slate-700 to-slate-900 text-white shadow-lg' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>Compact</Button>
                </div>
              </div>
              <Button
                onClick={handleGenerateTestData}
                variant="outline"
                size="sm"
                className="bg-white/80 backdrop-blur-sm hover:bg-gradient-to-r hover:from-green-50 hover:to-emerald-50 hover:border-green-300 hover:text-green-700 hover:shadow-lg transition-all duration-300 transform hover:scale-105 font-semibold"
                disabled={isLoading}
              >
                <Database className="h-4 w-4 mr-2" />
                Generate Test Data
              </Button>

              <Button
                onClick={handleManualRefresh}
                variant="outline"
                size="sm"
                className="bg-white/80 backdrop-blur-sm hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 hover:border-blue-400 hover:text-blue-700 hover:shadow-lg transition-all duration-300 transform hover:scale-105 font-semibold"
                disabled={isLoading}
              >
                <Activity className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            <div className="flex flex-col items-end gap-1 bg-white/80 backdrop-blur-sm px-3 py-2 rounded-lg shadow-md border border-gray-200/50">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-gray-500" />
                <span className="text-xs text-gray-500 font-semibold">Last Update</span>
              </div>
              <div className="text-xs text-gray-700 font-mono font-bold">
                {lastUpdateTime ? new Date(lastUpdateTime).toLocaleTimeString() : '--:--:--'}
              </div>
            </div>
          </div>
        </div>

        {/* Enhanced Tab Navigation */}
        <div className="flex gap-2 p-2 bg-white/80 backdrop-blur-md rounded-2xl shadow-xl border border-gray-200/50">
          {(['overview', 'tokens', 'providers', 'sessions', 'history'] as const).map((tab, index) => {
            const icons = {
              overview: <Activity className="h-4 w-4" />,
              tokens: <Database className="h-4 w-4" />,
              providers: <Server className="h-4 w-4" />,
              sessions: <Users className="h-4 w-4" />,
              history: <Clock className="h-4 w-4" />
            };
            
            return (
              <Button
                key={tab}
                variant={selectedTab === tab ? "default" : "ghost"}
                size="sm"
                onClick={() => setSelectedTab(tab)}
                className={`capitalize transition-all duration-300 font-semibold ${
                  selectedTab === tab
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-500/30 scale-105'
                    : 'hover:bg-gradient-to-r hover:from-gray-100 hover:to-gray-50 hover:scale-105'
                }`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <span className={selectedTab === tab ? 'animate-pulse' : ''}>
                  {icons[tab]}
                </span>
                <span className="ml-2">{tab}</span>
              </Button>
            );
          })}
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
            <Card className="shadow-2xl border border-blue-200/50 backdrop-blur-sm bg-white/80 hover:shadow-blue-200/50 transition-all duration-500 animate-fade-in">
              <CardHeader className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 text-white border-b-0">
                <CardTitle className="flex items-center gap-2 text-white">
                  <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                    <Server className="h-5 w-5" />
                  </div>
                  Top Models by Token Usage
                </CardTitle>
                <CardDescription className="text-blue-50">Models with highest token consumption</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-200">
                  {tokenAnalytics.topModelsByTokens.slice(0, 10).map((model, index) => (
                    <div key={index} className="flex items-center justify-between p-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 transition-all duration-300 group cursor-pointer border-l-4 border-transparent hover:border-blue-500">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full flex items-center justify-center text-sm font-bold text-blue-700 shadow-md group-hover:scale-110 transition-transform duration-300">
                          {index + 1}
                        </div>
                        <div>
                          <div className="font-bold text-gray-900 group-hover:text-blue-700 transition-colors">{model.model}</div>
                          <div className="text-sm text-gray-500 font-medium">{model.provider}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-gray-900 text-lg group-hover:text-blue-700 transition-colors">{formatNumber(model.tokens)}</div>
                        <div className="text-sm font-bold text-green-600 bg-green-50 px-2 py-1 rounded">{formatCost(model.cost)}</div>
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

            <Card className="shadow-2xl border border-green-200/50 backdrop-blur-sm bg-white/80 hover:shadow-green-200/50 transition-all duration-500 animate-fade-in">
              <CardHeader className="bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 text-white border-b-0">
                <CardTitle className="flex items-center gap-2 text-white">
                  <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                    <Clock className="h-5 w-5" />
                  </div>
                  24-Hour Token Usage
                </CardTitle>
                <CardDescription className="text-green-50">Hourly token consumption pattern</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-y-auto">
                  {tokenAnalytics.hourlyTokenUsage.slice(-24).map((hour, index) => (
                    <div key={index} className="flex items-center justify-between p-4 border-b border-gray-100 hover:bg-gradient-to-r hover:from-green-50 hover:to-emerald-50 transition-all duration-300 group cursor-pointer border-l-4 border-transparent hover:border-green-500">
                      <div className="font-bold text-gray-900 bg-gray-100 px-3 py-1 rounded-lg group-hover:bg-green-100 group-hover:text-green-700 transition-all">{hour.hour}:00</div>
                      <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg group-hover:bg-blue-100 transition-colors">
                          <Database className="h-4 w-4 text-blue-500" />
                          <span className="font-bold text-blue-600">{formatNumber(hour.inputTokens)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-gray-400 font-bold">
                          →
                        </div>
                        <div className="flex items-center gap-2 bg-green-50 px-3 py-1.5 rounded-lg group-hover:bg-green-100 transition-colors">
                          <Globe className="h-4 w-4 text-green-500" />
                          <span className="font-bold text-green-600">{formatNumber(hour.outputTokens)}</span>
                        </div>
                        <div className="font-bold text-green-700 bg-green-100 px-3 py-1.5 rounded-lg shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all">
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
        <Card className="shadow-2xl border border-purple-200/50 backdrop-blur-sm bg-white/80 animate-fade-in">
          <CardHeader className="bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500 text-white border-b-0">
            <CardTitle className="flex items-center gap-2 text-white">
              <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                <Server className="h-5 w-5" />
              </div>
              Provider Analytics
            </CardTitle>
            <CardDescription className="text-purple-50">Detailed usage statistics per LLM provider</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-purple-50 to-pink-50 border-b-2 border-purple-200 sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-purple-50/90">
                  <tr>
                    <th className={`text-left ${headerPadding} font-bold text-purple-900 uppercase text-xs tracking-wider`}>Provider</th>
                    <th className={`text-left ${headerPadding} font-bold text-purple-900 uppercase text-xs tracking-wider`}>Model</th>
                    <th className={`text-right ${headerPadding} font-bold text-purple-900 uppercase text-xs tracking-wider`}>Requests</th>
                    <th className={`text-right ${headerPadding} font-bold text-purple-900 uppercase text-xs tracking-wider`}>Input Tokens</th>
                    <th className={`text-right ${headerPadding} font-bold text-purple-900 uppercase text-xs tracking-wider`}>Output Tokens</th>
                    <th className={`text-right ${headerPadding} font-bold text-purple-900 uppercase text-xs tracking-wider`}>Errors</th>
                    <th className={`text-right ${headerPadding} font-bold text-purple-900 uppercase text-xs tracking-wider`}>Avg Latency</th>
                    <th className={`text-right ${headerPadding} font-bold text-purple-900 uppercase text-xs tracking-wider`}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {providerMetrics.map((provider, index) => (
                    <tr key={index} className={`border-b border-gray-100 hover:bg-gradient-to-r hover:from-purple-50 hover:to-pink-50 transition-all duration-300 group ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                      <td className={cellPadding}>
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-purple-500" />
                          <span className="font-medium">{provider.provider}</span>
                        </div>
                      </td>
                      <td className={`${cellPadding} font-medium`}>{provider.model}</td>
                      <td className={`text-right ${cellPadding} font-semibold`}>{formatNumber(provider.requests)}</td>
                      <td className={`text-right ${cellPadding}`}>{formatNumber(provider.inputTokens)}</td>
                      <td className={`text-right ${cellPadding}`}>{formatNumber(provider.outputTokens)}</td>
                      <td className={`text-right ${cellPadding}`}>
                        {provider.errors > 0 ? (
                          <Badge variant="destructive">{provider.errors}</Badge>
                        ) : (
                          <span className="text-green-600 font-medium">0</span>
                        )}
                      </td>
                      <td className={`text-right ${cellPadding} font-medium ${
                        getStatusColor(provider.averageLatency, 'latency') === 'success' ? 'text-green-600' :
                        getStatusColor(provider.averageLatency, 'latency') === 'warning' ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {formatDuration(provider.averageLatency)}
                      </td>
                      <td className={`text-right ${cellPadding} font-medium text-green-600`}>
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
        <Card className="shadow-2xl border border-cyan-200/50 backdrop-blur-sm bg-white/80 animate-fade-in">
          <CardHeader className="bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 text-white border-b-0">
            <CardTitle className="flex items-center gap-2 text-white">
              <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                <Users className="h-5 w-5" />
              </div>
              Active Sessions
            </CardTitle>
            <CardDescription className="text-cyan-50">Currently active Claude Code sessions</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-cyan-50 to-blue-50 border-b-2 border-cyan-200 sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-cyan-50/90">
                  <tr>
                    <th className={`text-left ${headerPadding} font-bold text-cyan-900 uppercase text-xs tracking-wider`}>Session ID</th>
                    <th className={`text-left ${headerPadding} font-bold text-cyan-900 uppercase text-xs tracking-wider`}>Provider</th>
                    <th className={`text-left ${headerPadding} font-bold text-cyan-900 uppercase text-xs tracking-wider`}>Model</th>
                    <th className={`text-right ${headerPadding} font-bold text-cyan-900 uppercase text-xs tracking-wider`}>Requests</th>
                    <th className={`text-right ${headerPadding} font-bold text-cyan-900 uppercase text-xs tracking-wider`}>Total Tokens</th>
                    <th className={`text-left ${headerPadding} font-bold text-cyan-900 uppercase text-xs tracking-wider`}>Duration</th>
                    <th className={`text-left ${headerPadding} font-bold text-cyan-900 uppercase text-xs tracking-wider`}>Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionMetrics.map((session, index) => (
                    <tr key={index} className={`border-b border-gray-100 hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 transition-all duration-300 group ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                      <td className={cellPadding}>
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-cyan-500" />
                          <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                            {session.sessionId.substring(0, 8)}...
                          </span>
                        </div>
                      </td>
                      <td className={`${cellPadding} font-medium`}>{session.provider}</td>
                      <td className={cellPadding}>{session.model}</td>
                      <td className={`text-right ${cellPadding} font-semibold`}>{formatNumber(session.requestCount)}</td>
                      <td className={`text-right ${cellPadding}`}>
                        {formatNumber(session.inputTokens + session.outputTokens)}
                      </td>
                      <td className={cellPadding}>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-gray-400" />
                          {formatUptime((Date.now() - session.startTime) / 1000)}
                        </div>
                      </td>
                      <td className={`${cellPadding} text-sm text-gray-600`}>{formatTimestamp(session.lastActivity)}</td>
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
        <Card className="shadow-2xl border border-orange-200/50 backdrop-blur-sm bg-white/80 animate-fade-in">
          <CardHeader className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 text-white border-b-0">
            <CardTitle className="flex items-center gap-2 text-white">
              <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                <Clock className="h-5 w-5" />
              </div>
              Request History
            </CardTitle>
            <CardDescription className="text-orange-50">Recent API requests with detailed information</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-orange-50 to-red-50 border-b-2 border-orange-200 sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-white/75">
                  <tr>
                    <th className="text-left p-4 font-bold text-orange-900 uppercase text-xs tracking-wider">Time</th>
                    <th className="text-left p-4 font-bold text-orange-900 uppercase text-xs tracking-wider">Provider</th>
                    <th className="text-left p-4 font-bold text-orange-900 uppercase text-xs tracking-wider">Model</th>
                    <th className="text-right p-4 font-bold text-orange-900 uppercase text-xs tracking-wider">Input Tokens</th>
                    <th className="text-right p-4 font-bold text-orange-900 uppercase text-xs tracking-wider">Output Tokens</th>
                    <th className="text-right p-4 font-bold text-orange-900 uppercase text-xs tracking-wider">Latency</th>
                    <th className="text-left p-4 font-bold text-orange-900 uppercase text-xs tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {requestHistory.map((request, index) => (
                    <tr key={index} className={`border-b border-gray-100 hover:bg-gradient-to-r hover:from-orange-50 hover:to-red-50 transition-all duration-300 group ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                      <td className={cellPadding}>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-gray-400" />
                          {formatTimestamp(request.timestamp)}
                        </div>
                      </td>
                      <td className={`${cellPadding} font-medium`}>{request.provider}</td>
                      <td className={cellPadding}>{request.model}</td>
                      <td className={`text-right ${cellPadding}`}>{formatNumber(request.inputTokens)}</td>
                      <td className={`text-right ${cellPadding}`}>{formatNumber(request.outputTokens)}</td>
                      <td className={`text-right ${cellPadding} font-medium ${
                        getStatusColor(request.duration, 'latency') === 'success' ? 'text-green-600' :
                        getStatusColor(request.duration, 'latency') === 'warning' ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {formatDuration(request.duration)}
                      </td>
                      <td className={cellPadding}>
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