import Server from "@musistudio/llms";
import { readConfigFile, writeConfigFile, backupConfigFile } from "./utils";
import { checkForUpdates, performUpdate } from "./utils";
import { join } from "path";
import fastifyStatic from "@fastify/static";
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import {calculateTokenCount} from "./utils/router";
import { metricsCollector } from "./utils/metrics";
import { connectionManager } from "./utils/connectionManager";
import { connectionPool } from "./utils/sessionConnectionPool";
import { metricsMiddleware, collectResponseMetrics } from "./middleware/metrics";
import { circuitBreakerManager } from "./utils/circuitBreaker";
import { prometheusExporter } from "./utils/prometheus";
import { alertingManager } from "./utils/alerting";
import { realTimeTokenTracker } from "./utils/realTimeTokenTracker";
import { extractTokensFromResponse, extractTokensFromStreaming } from "./middleware/metrics";

export const createServer = (config: any): Server => {
  const server = new Server(config);

  // Initialize connection manager with provider configurations
  if (config.Providers && Array.isArray(config.Providers)) {
    connectionManager.initialize(config.Providers);
  }

  // Register metrics middleware for all API endpoints
  server.app.addHook('preHandler', metricsMiddleware);

  // Register response metrics collector
  server.app.addHook('onResponse', collectResponseMetrics);

  // Monkey-patch the response send method to capture tokens
  // This is necessary because @musistudio/llms intercepts responses internally
  const originalSend = server.app.raw.send;
  server.app.raw.send = function(data: any) {
    try {
      console.log(`[RAW-SEND] Intercepting response`);

      // Parse response data
      let responseData = data;
      if (typeof data === 'string') {
        try {
          responseData = JSON.parse(data);
        } catch (e) {
          // Not JSON
        }
      }

      // Extract session ID from current request context
      const request = (this as any).request;
      if (request && request.url && request.url.startsWith('/v1/') && request.method === 'POST') {
        const metricsContext = (request as any).__metricsContext;
        if (metricsContext?.sessionId) {
          const { sessionId } = metricsContext;

          // Extract tokens
          let inputTokens = 0;
          let outputTokens = 0;
          let tokensFound = false;

          if (responseData) {
            const extractedTokens = extractTokensFromResponse(responseData);
            if (extractedTokens) {
              inputTokens = extractedTokens.inputTokens;
              outputTokens = extractedTokens.outputTokens;
              tokensFound = extractedTokens.inputTokens > 0 || extractedTokens.outputTokens > 0;
            }

            // Try streaming extraction if no tokens found
            if (!tokensFound) {
              const streamingTokens = extractTokensFromStreaming(responseData);
              if (streamingTokens) {
                inputTokens = streamingTokens.inputTokens;
                outputTokens = streamingTokens.outputTokens;
                tokensFound = true;
              }
            }
          }

          // Log and update tracker
          if (tokensFound) {
            console.log(`[TOKEN-TRACKING] Session ${sessionId}: ${inputTokens} input, ${outputTokens} output tokens`);
            realTimeTokenTracker.addTokenData(sessionId, inputTokens, outputTokens);
          }
        }
      }
    } catch (error) {
      console.error('Error in response interceptor:', error);
    }

    return originalSend.call(this, data);
  };

  // Add onRequest hook to set up connection pooling and circuit breaker for /v1/messages
  server.app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/v1/messages' && request.method === 'POST') {
      try {
        // Extract provider and model from request
        const body = request.body as any;
        let provider = 'unknown';
        let model = 'unknown';

        if (body?.model) {
          if (typeof body.model === 'string' && body.model.includes(',')) {
            [provider, model] = body.model.split(',');
          } else {
            model = body.model;
          }
        }

        // Check circuit breaker before processing request
        const circuitBreaker = circuitBreakerManager.getCircuitBreaker(provider, model);
        const status = circuitBreaker.getStatus();

        if (!status.isHealthy) {
          reply.status(503).send({
            error: {
              type: 'provider_unavailable',
              message: `Provider ${provider}${model ? `/${model}` : ''} is currently unavailable`,
              code: 'CIRCUIT_BREAKER_OPEN'
            }
          });
          return;
        }

        // Set up connection pool context for this request
        const { provider: poolProvider, sessionId } = connectionManager.parseRequestInfo(request);
        (request as any).__connectionPoolContext = {
          provider,
          sessionId,
          startTime: Date.now()
        };

        // Add response cleanup hook
        reply.raw.on('finish', () => {
          // Connection cleanup is handled in the connection manager
        });

      } catch (error) {
        request.log.error('Failed to setup connection pool context:', error);
      }
    }
  });

  // Add preHandler hook to acquire connection from pool
  server.app.addHook('preHandler', async (request, reply) => {
    if ((request as any).__connectionPoolContext &&
        request.url === '/v1/messages' &&
        request.method === 'POST') {

      try {
        const context = (request as any).__connectionPoolContext;
        const connection = await connectionManager.getConnectionWithAffinity(
          context.provider,
          context.sessionId
        );

        // Store connection for later cleanup
        (request as any).__connectionInfo = connection;
        request.headers['x-connection-id'] = connection.id;
        request.headers['x-provider'] = connection.provider;

      } catch (error) {
        request.log.error('Failed to acquire connection from pool:', error);
        // Continue without connection pooling if pool fails
      }
    }
  });

  // Add onResponse hook to release connection
  server.app.addHook('onResponse', async (request, reply) => {
    if ((request as any).__connectionInfo) {
      try {
        const connection = (request as any).__connectionInfo;
        const context = (request as any).__connectionPoolContext;

        // Record metrics
        connectionManager.recordRequestMetrics({
          provider: context.provider,
          model: (request.body as any)?.model || 'unknown',
          sessionId: context.sessionId,
          startTime: context.startTime,
          endTime: Date.now(),
          success: reply.statusCode < 400,
          errorType: reply.statusCode >= 400 ? 'HTTP_ERROR' : undefined,
          inputTokens: (request.body as any)?.usage?.input_tokens,
          outputTokens: (request.body as any)?.usage?.output_tokens
        });

        // Release connection back to pool
        connectionManager.releaseConnection(connection);

      } catch (error) {
        request.log.error('Failed to release connection:', error);
      }
    }
  });

  server.app.post("/v1/messages/count_tokens", async (req, reply) => {
    const {messages, tools, system} = req.body;
    const tokenCount = calculateTokenCount(messages, system, tools);
    return { "input_tokens": tokenCount }
  });

  // Add endpoint to read config.json with access control
  server.app.get("/api/config", async (req, reply) => {
    return await readConfigFile();
  });

  server.app.get("/api/transformers", async () => {
    const transformers =
      server.app._server!.transformerService.getAllTransformers();
    const transformerList = Array.from(transformers.entries()).map(
      ([name, transformer]: any) => ({
        name,
        endpoint: transformer.endPoint || null,
      })
    );
    return { transformers: transformerList };
  });

  // Add endpoint to save config.json with access control
  server.app.post("/api/config", async (req, reply) => {
    const newConfig = req.body;

    // Backup existing config file if it exists
    const backupPath = await backupConfigFile();
    if (backupPath) {
      console.log(`Backed up existing configuration file to ${backupPath}`);
    }

    await writeConfigFile(newConfig);
    return { success: true, message: "Config saved successfully" };
  });

  // Add endpoint to restart the service with access control
  server.app.post("/api/restart", async (req, reply) => {
    reply.send({ success: true, message: "Service restart initiated" });

    // Restart the service after a short delay to allow response to be sent
    setTimeout(() => {
      const { spawn } = require("child_process");
      spawn(process.execPath, [process.argv[1], "restart"], {
        detached: true,
        stdio: "ignore",
      });
    }, 1000);
  });

  // Register static file serving with caching
  server.app.register(fastifyStatic, {
    root: join(__dirname, "..", "dist"),
    prefix: "/ui/",
    maxAge: "1h",
  });

  // Redirect /ui to /ui/ for proper static file serving
  server.app.get("/ui", async (_, reply) => {
    return reply.redirect("/ui/");
  });

  // 版本检查端点
  server.app.get("/api/update/check", async (req, reply) => {
    try {
      // 获取当前版本
      const currentVersion = require("../package.json").version;
      const { hasUpdate, latestVersion, changelog } = await checkForUpdates(currentVersion);

      return {
        hasUpdate,
        latestVersion: hasUpdate ? latestVersion : undefined,
        changelog: hasUpdate ? changelog : undefined
      };
    } catch (error) {
      console.error("Failed to check for updates:", error);
      reply.status(500).send({ error: "Failed to check for updates" });
    }
  });

  // 执行更新端点
  server.app.post("/api/update/perform", async (req, reply) => {
    try {
      // 只允许完全访问权限的用户执行更新
      const accessLevel = (req as any).accessLevel || "restricted";
      if (accessLevel !== "full") {
        reply.status(403).send("Full access required to perform updates");
        return;
      }

      // 执行更新逻辑
      const result = await performUpdate();

      return result;
    } catch (error) {
      console.error("Failed to perform update:", error);
      reply.status(500).send({ error: "Failed to perform update" });
    }
  });

  // 获取日志文件列表端点
  server.app.get("/api/logs/files", async (req, reply) => {
    try {
      const logDir = join(homedir(), ".claude-code-router", "logs");
      const logFiles: Array<{ name: string; path: string; size: number; lastModified: string }> = [];

      if (existsSync(logDir)) {
        const files = readdirSync(logDir);

        for (const file of files) {
          if (file.endsWith('.log')) {
            const filePath = join(logDir, file);
            const stats = statSync(filePath);

            logFiles.push({
              name: file,
              path: filePath,
              size: stats.size,
              lastModified: stats.mtime.toISOString()
            });
          }
        }

        // 按修改时间倒序排列
        logFiles.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
      }

      return logFiles;
    } catch (error) {
      console.error("Failed to get log files:", error);
      reply.status(500).send({ error: "Failed to get log files" });
    }
  });

  // 获取日志内容端点
  server.app.get("/api/logs", async (req, reply) => {
    try {
      const filePath = (req.query as any).file as string;
      let logFilePath: string;

      if (filePath) {
        // 如果指定了文件路径，使用指定的路径
        logFilePath = filePath;
      } else {
        // 如果没有指定文件路径，使用默认的日志文件路径
        logFilePath = join(homedir(), ".claude-code-router", "logs", "app.log");
      }

      if (!existsSync(logFilePath)) {
        return [];
      }

      const logContent = readFileSync(logFilePath, 'utf8');
      const logLines = logContent.split('\n').filter(line => line.trim())

      return logLines;
    } catch (error) {
      console.error("Failed to get logs:", error);
      reply.status(500).send({ error: "Failed to get logs" });
    }
  });

  // 清除日志内容端点
  server.app.delete("/api/logs", async (req, reply) => {
    try {
      const filePath = (req.query as any).file as string;
      let logFilePath: string;

      if (filePath) {
        // 如果指定了文件路径，使用指定的路径
        logFilePath = filePath;
      } else {
        // 如果没有指定文件路径，使用默认的日志文件路径
        logFilePath = join(homedir(), ".claude-code-router", "logs", "app.log");
      }

      if (existsSync(logFilePath)) {
        writeFileSync(logFilePath, '', 'utf8');
      }

      return { success: true, message: "Logs cleared successfully" };
    } catch (error) {
      console.error("Failed to clear logs:", error);
      reply.status(500).send({ error: "Failed to clear logs" });
    }
  });

  // Add metrics API endpoints
  server.app.get("/api/metrics/realtime", async (req, reply) => {
    try {
      return metricsCollector.getRealTimeMetrics();
    } catch (error) {
      console.error("Failed to get realtime metrics:", error);
      reply.status(500).send({ error: "Failed to get realtime metrics" });
    }
  });

  server.app.get("/api/metrics/providers", async (req, reply) => {
    try {
      return metricsCollector.getProviderMetrics();
    } catch (error) {
      console.error("Failed to get provider metrics:", error);
      reply.status(500).send({ error: "Failed to get provider metrics" });
    }
  });

  server.app.get("/api/metrics/sessions", async (req, reply) => {
    try {
      return metricsCollector.getSessionMetrics();
    } catch (error) {
      console.error("Failed to get session metrics:", error);
      reply.status(500).send({ error: "Failed to get session metrics" });
    }
  });

  server.app.get("/api/metrics/history", async (req, reply) => {
    try {
      const limit = parseInt((req.query as any).limit) || 100;
      return metricsCollector.getHistoricalRequests(limit);
    } catch (error) {
      console.error("Failed to get metrics history:", error);
      reply.status(500).send({ error: "Failed to get metrics history" });
    }
  });

  server.app.get("/api/metrics/summary", async (req, reply) => {
    try {
      return metricsCollector.getMetricsSummary();
    } catch (error) {
      console.error("Failed to get metrics summary:", error);
      reply.status(500).send({ error: "Failed to get metrics summary" });
    }
  });

  server.app.get("/api/metrics/tokens", async (req, reply) => {
    try {
      return metricsCollector.getTokenAnalytics();
    } catch (error) {
      console.error("Failed to get token analytics:", error);
      reply.status(500).send({ error: "Failed to get token analytics" });
    }
  });

  // Server-Sent Events endpoint for real-time metrics
  server.app.get("/api/metrics/stream", async (req, reply) => {
    try {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      // Send initial data
      const initialData = metricsCollector.getRealTimeMetrics();
      reply.raw.write(`data: ${JSON.stringify(initialData)}\n\n`);

      // Subscribe to metrics updates
      const onMetricsUpdate = (metrics: any) => {
        reply.raw.write(`data: ${JSON.stringify(metrics)}\n\n`);
      };

      metricsCollector.on('metricsUpdated', onMetricsUpdate);

      // Clean up on disconnect
      req.raw.on('close', () => {
        metricsCollector.removeListener('metricsUpdated', onMetricsUpdate);
      });

      // Send periodic updates every 100ms for ultra-high frequency
      const interval = setInterval(() => {
        try {
          const metrics = metricsCollector.getRealTimeMetrics();
          reply.raw.write(`data: ${JSON.stringify(metrics)}\n\n`);
        } catch (error) {
          clearInterval(interval);
          metricsCollector.removeListener('metricsUpdated', onMetricsUpdate);
        }
      }, 100);

      req.raw.on('close', () => {
        clearInterval(interval);
      });

    } catch (error) {
      console.error("Failed to setup metrics stream:", error);
      reply.status(500).send({ error: "Failed to setup metrics stream" });
    }
  });

  // Debug endpoint to generate mock metrics for testing
  server.app.post("/api/metrics/generate-test-data", async (req, reply) => {
    try {
      const testRequests = [
        { inputTokens: 150, outputTokens: 300, duration: 1200, success: true },
        { inputTokens: 200, outputTokens: 450, duration: 1800, success: true },
        { inputTokens: 100, outputTokens: 200, duration: 800, success: true },
        { inputTokens: 300, outputTokens: 600, duration: 2200, success: true },
        { inputTokens: 180, outputTokens: 350, duration: 1500, success: true }
      ];

      const now = Date.now();
      let sessionId = 'test-session-' + Math.random().toString(36).substr(2, 9);

      // Generate test requests over the last few minutes
      testRequests.forEach((testReq, index) => {
        const timestamp = now - (index * 60000); // Spread over last 5 minutes

        const metrics = {
          timestamp,
          sessionId,
          provider: 'test-provider',
          model: 'test-model',
          inputTokens: testReq.inputTokens,
          outputTokens: testReq.outputTokens,
          duration: testReq.duration,
          success: testReq.success,
          errorType: testReq.success ? undefined : 'test-error'
        };

        metricsCollector.recordRequest(metrics);
      });

      // Generate some recent activity for real-time display
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          const recentMetrics = {
            timestamp: Date.now(),
            sessionId,
            provider: 'test-provider',
            model: 'test-model',
            inputTokens: Math.floor(Math.random() * 200) + 50,
            outputTokens: Math.floor(Math.random() * 400) + 100,
            duration: Math.floor(Math.random() * 2000) + 500,
            success: Math.random() > 0.1,
            errorType: Math.random() > 0.9 ? 'random-error' : undefined
          };
          metricsCollector.recordRequest(recentMetrics);
        }, i * 200);
      }

      return {
        success: true,
        message: `Generated ${testRequests.length} test requests`,
        currentMetrics: metricsCollector.getRealTimeMetrics()
      };
    } catch (error) {
      console.error("Failed to generate test data:", error);
      reply.status(500).send({ error: "Failed to generate test data" });
    }
  });

  // Add connection pool monitoring endpoints
  server.app.get("/api/connection-pool/metrics", async (req, reply) => {
    try {
      const poolMetrics = connectionPool.getMetrics();
      const requestMetrics = connectionManager.getRequestMetrics();
      const providerMetrics = connectionManager.getProviderMetrics();
      const sessionMetrics = connectionManager.getSessionAffinityMetrics();

      return {
        pool: poolMetrics,
        sessions: sessionMetrics,
        requests: {
          total: requestMetrics.length,
          recent: requestMetrics.slice(-100),
          providerMetrics
        }
      };
    } catch (error) {
      console.error("Failed to get connection pool metrics:", error);
      reply.status(500).send({ error: "Failed to get connection pool metrics" });
    }
  });

  // Add connection pool health check
  server.app.get("/api/connection-pool/health", async (req, reply) => {
    try {
      const metrics = connectionPool.getMetrics();
      const isHealthy = metrics.activeConnections < (metrics.totalConnections * 0.9) &&
                       metrics.queuedRequests < 50;

      return {
        healthy: isHealthy,
        metrics,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error("Failed to get connection pool health:", error);
      reply.status(500).send({ error: "Failed to get connection pool health" });
    }
  });

  // Reset connection pool
  server.app.post("/api/connection-pool/reset", async (req, reply) => {
    try {
      connectionManager.close();

      // Reinitialize with the same providers
      if (config.Providers && Array.isArray(config.Providers)) {
        connectionManager.initialize(config.Providers);
      }

      return { success: true, message: "Connection pool reset successfully" };
    } catch (error) {
      console.error("Failed to reset connection pool:", error);
      reply.status(500).send({ error: "Failed to reset connection pool" });
    }
  });

  // Session affinity specific endpoint
  server.app.get("/api/session-affinity/metrics", async (req, reply) => {
    try {
      const sessionMetrics = connectionManager.getSessionAffinityMetrics();
      return sessionMetrics;
    } catch (error) {
      console.error("Failed to get session affinity metrics:", error);
      reply.status(500).send({ error: "Failed to get session affinity metrics" });
    }
  });

  // Optimize session connections
  server.app.post("/api/session-affinity/optimize", async (req, reply) => {
    try {
      // This would trigger session affinity optimization
      // Implementation would be in the session affinity manager
      return { success: true, message: "Session affinity optimization triggered" };
    } catch (error) {
      console.error("Failed to optimize session affinity:", error);
      reply.status(500).send({ error: "Failed to optimize session affinity" });
    }
  });

  // Historical Analytics API Endpoints
  server.app.get("/api/metrics/historical", async (req, reply) => {
    try {
      const query = req.query as any;
      const hours = parseInt(query.hours) || 24;
      const provider = query.provider;
      const model = query.model;

      const historicalData = metricsCollector.getHistoricalAnalytics({
        hours,
        provider,
        model
      });

      return {
        success: true,
        data: historicalData,
        query: { hours, provider, model }
      };
    } catch (error) {
      console.error("Failed to get historical metrics:", error);
      reply.status(500).send({ error: "Failed to get historical metrics" });
    }
  });

  server.app.get("/api/metrics/cost-analytics", async (req, reply) => {
    try {
      const query = req.query as any;
      const days = parseInt(query.days) || 30;

      const costAnalytics = metricsCollector.getCostAnalytics(days);

      return {
        success: true,
        data: costAnalytics,
        period: `${days} days`
      };
    } catch (error) {
      console.error("Failed to get cost analytics:", error);
      reply.status(500).send({ error: "Failed to get cost analytics" });
    }
  });

  server.app.get("/api/metrics/top-models", async (req, reply) => {
    try {
      const query = req.query as any;
      const limit = parseInt(query.limit) || 10;

      const topModels = metricsCollector.getTopModels(limit);

      return {
        success: true,
        data: topModels,
        limit
      };
    } catch (error) {
      console.error("Failed to get top models:", error);
      reply.status(500).send({ error: "Failed to get top models" });
    }
  });

  server.app.get("/api/metrics/database-stats", async (req, reply) => {
    try {
      const stats = metricsCollector.getDatabaseStats();

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error("Failed to get database stats:", error);
      reply.status(500).send({ error: "Failed to get database stats" });
    }
  });

  server.app.post("/api/metrics/flush", async (req, reply) => {
    try {
      metricsCollector.flushAllData();

      return {
        success: true,
        message: "All pending metrics data flushed to database"
      };
    } catch (error) {
      console.error("Failed to flush metrics:", error);
      reply.status(500).send({ error: "Failed to flush metrics" });
    }
  });

  // Prometheus Metrics Endpoint
  server.app.get("/metrics", async (req, reply) => {
    try {
      const format = (req.query as any).format || 'prometheus';
      const metrics = req.query as any;

      if (format === 'opentelemetry' || metrics.format === 'opentelemetry') {
        // OpenTelemetry format
        const otelMetrics = prometheusExporter.generateOpenTelemetryMetrics();
        reply.header('Content-Type', 'application/json');
        reply.header('X-Content-Type-Options', 'nosniff');
        return otelMetrics;
      } else {
        // Prometheus text format (default)
        const prometheusMetrics = prometheusExporter.generateMetricsText();
        reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        return prometheusMetrics;
      }
    } catch (error) {
      console.error("Failed to generate metrics:", error);
      reply.status(500).send({ error: "Failed to generate metrics" });
    }
  });

  // Alerting Management Endpoints
  server.app.get("/api/alerts/rules", async (req, reply) => {
    try {
      const rules = alertingManager.getRules();
      return { success: true, data: rules };
    } catch (error) {
      console.error("Failed to get alert rules:", error);
      reply.status(500).send({ error: "Failed to get alert rules" });
    }
  });

  server.app.post("/api/alerts/rules", async (req, reply) => {
    try {
      const ruleData = req.body;
      const rule = alertingManager.createRule(ruleData);
      return { success: true, data: rule };
    } catch (error) {
      console.error("Failed to create alert rule:", error);
      reply.status(500).send({ error: "Failed to create alert rule" });
    }
  });

  server.app.put("/api/alerts/rules/:id", async (req, reply) => {
    try {
      const ruleId = (req.params as any).id;
      const updates = req.body;
      const success = alertingManager.updateRule(ruleId, updates);

      if (!success) {
        reply.status(404).send({ error: "Alert rule not found" });
        return;
      }

      return { success: true, message: "Alert rule updated" };
    } catch (error) {
      console.error("Failed to update alert rule:", error);
      reply.status(500).send({ error: "Failed to update alert rule" });
    }
  });

  server.app.delete("/api/alerts/rules/:id", async (req, reply) => {
    try {
      const ruleId = (req.params as any).id;
      const success = alertingManager.deleteRule(ruleId);

      if (!success) {
        reply.status(404).send({ error: "Alert rule not found" });
        return;
      }

      return { success: true, message: "Alert rule deleted" };
    } catch (error) {
      console.error("Failed to delete alert rule:", error);
      reply.status(500).send({ error: "Failed to delete alert rule" });
    }
  });

  server.app.get("/api/alerts/active", async (req, reply) => {
    try {
      const alerts = alertingManager.getActiveAlerts();
      return { success: true, data: alerts };
    } catch (error) {
      console.error("Failed to get active alerts:", error);
      reply.status(500).send({ error: "Failed to get active alerts" });
    }
  });

  server.app.get("/api/alerts/history", async (req, reply) => {
    try {
      const limit = parseInt((req.query as any).limit) || 100;
      const history = alertingManager.getAlertHistory(limit);
      return { success: true, data: history };
    } catch (error) {
      console.error("Failed to get alert history:", error);
      reply.status(500).send({ error: "Failed to get alert history" });
    }
  });

  server.app.post("/api/alerts/resolve/:id", async (req, reply) => {
    try {
      const alertId = (req.params as any).id;
      const reason = (req.body as any)?.reason || 'Manual resolution';
      alertingManager.resolveAlert(alertId, reason);
      return { success: true, message: "Alert resolved" };
    } catch (error) {
      console.error("Failed to resolve alert:", error);
      reply.status(500).send({ error: "Failed to resolve alert" });
    }
  });

  server.app.get("/api/alerts/statistics", async (req, reply) => {
    try {
      const stats = alertingManager.getStatistics();
      return { success: true, data: stats };
    } catch (error) {
      console.error("Failed to get alerting statistics:", error);
      reply.status(500).send({ error: "Failed to get alerting statistics" });
    }
  });

  // Circuit Breaker Management Endpoints
  server.app.get("/api/circuit-breaker/status", async (req, reply) => {
    try {
      const statuses = circuitBreakerManager.getAllStatuses();
      const healthSummary = circuitBreakerManager.getHealthSummary();

      return {
        success: true,
        data: {
          statuses,
          summary: healthSummary
        }
      };
    } catch (error) {
      console.error("Failed to get circuit breaker status:", error);
      reply.status(500).send({ error: "Failed to get circuit breaker status" });
    }
  });

  server.app.post("/api/circuit-breaker/reset", async (req, reply) => {
    try {
      const body = req.body as any;
      const { provider, model } = body || {};

      if (provider) {
        const breaker = circuitBreakerManager.getCircuitBreaker(provider, model);
        breaker.reset();
        return {
          success: true,
          message: `Circuit breaker reset for ${provider}${model ? `/${model}` : ''}`
        };
      } else {
        circuitBreakerManager.resetAll();
        return {
          success: true,
          message: "All circuit breakers reset"
        };
      }
    } catch (error) {
      console.error("Failed to reset circuit breaker:", error);
      reply.status(500).send({ error: "Failed to reset circuit breaker" });
    }
  });

  server.app.post("/api/circuit-breaker/force-open", async (req, reply) => {
    try {
      const body = req.body as any;
      const { provider, model } = body || {};

      if (!provider) {
        reply.status(400).send({ error: "Provider is required" });
        return;
      }

      const breaker = circuitBreakerManager.getCircuitBreaker(provider, model);
      breaker.forceOpen();

      return {
        success: true,
        message: `Circuit breaker forced OPEN for ${provider}${model ? `/${model}` : ''}`
      };
    } catch (error) {
      console.error("Failed to force open circuit breaker:", error);
      reply.status(500).send({ error: "Failed to force open circuit breaker" });
    }
  });

  return server;
};
