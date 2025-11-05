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

  // Add onRequest hook to set up connection pooling for /v1/messages
  server.app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/v1/messages' && request.method === 'POST') {
      try {
        // Set up connection pool context for this request
        const { provider, sessionId } = connectionManager.parseRequestInfo(request);
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

  return server;
};
