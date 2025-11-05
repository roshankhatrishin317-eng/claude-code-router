/**
 * Shin Mode Management Endpoints
 * 
 * REST API endpoints for managing and monitoring Shin Mode
 */

import { FastifyInstance } from 'fastify';
import { shinModeManager } from './utils/shinMode';

export function registerShinModeEndpoints(server: FastifyInstance) {
  // Get current mode
  server.get("/api/shin/mode", async (req, reply) => {
    try {
      const mode = shinModeManager.getMode();
      const stats = shinModeManager.getStats();
      
      return {
        success: true,
        data: {
          mode,
          enabled: stats.enabled,
          description: mode === 'shin' 
            ? 'Sequential processing - one request at a time per provider'
            : 'Normal processing - concurrent requests'
        }
      };
    } catch (error) {
      console.error("Failed to get Shin Mode:", error);
      reply.status(500).send({ error: "Failed to get Shin Mode" });
    }
  });

  // Switch mode
  server.post("/api/shin/mode", async (req, reply) => {
    try {
      const { mode } = req.body as any;
      
      if (!mode || !['normal', 'shin'].includes(mode)) {
        reply.status(400).send({ 
          error: "Invalid mode. Must be 'normal' or 'shin'" 
        });
        return;
      }

      shinModeManager.switchMode(mode);
      
      return {
        success: true,
        message: `Switched to ${mode} mode`,
        data: { mode }
      };
    } catch (error) {
      console.error("Failed to switch mode:", error);
      reply.status(500).send({ error: "Failed to switch mode" });
    }
  });

  // Get queue statistics
  server.get("/api/shin/queue", async (req, reply) => {
    try {
      const provider = (req.query as any).provider;
      
      if (provider) {
        const stats = shinModeManager.getQueueStats(provider);
        if (!stats) {
          reply.status(404).send({ 
            error: `No queue found for provider ${provider}` 
          });
          return;
        }
        return { success: true, data: stats };
      } else {
        const allStats = shinModeManager.getAllQueueStats();
        return { success: true, data: allStats };
      }
    } catch (error) {
      console.error("Failed to get queue stats:", error);
      reply.status(500).send({ error: "Failed to get queue stats" });
    }
  });

  // Get overall statistics
  server.get("/api/shin/stats", async (req, reply) => {
    try {
      const stats = shinModeManager.getStats();
      
      return {
        success: true,
        data: stats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error("Failed to get Shin Mode stats:", error);
      reply.status(500).send({ error: "Failed to get Shin Mode stats" });
    }
  });

  // Get queue size for a provider
  server.get("/api/shin/queue-size", async (req, reply) => {
    try {
      const provider = (req.query as any).provider;
      
      if (!provider) {
        reply.status(400).send({ error: "Provider parameter required" });
        return;
      }

      const queueSize = shinModeManager.getQueueSize(provider);
      
      return {
        success: true,
        data: {
          provider,
          queueSize
        }
      };
    } catch (error) {
      console.error("Failed to get queue size:", error);
      reply.status(500).send({ error: "Failed to get queue size" });
    }
  });

  // Get detailed queue information
  server.get("/api/shin/queue-details", async (req, reply) => {
    try {
      const stats = shinModeManager.getStats();
      
      const details = {
        mode: stats.mode,
        enabled: stats.enabled,
        summary: {
          totalQueued: stats.totalQueued,
          totalProcessing: stats.totalProcessing,
          totalProcessed: stats.totalProcessed
        },
        providers: stats.providers.map(p => ({
          provider: p.provider,
          queueLength: p.queueLength,
          processing: p.processing,
          totalProcessed: p.totalProcessed,
          averageWaitTime: Math.round(p.averageWaitTime),
          longestWaitTime: Math.round(p.longestWaitTime),
          oldestRequestAge: Math.round(p.oldestRequestAge),
          status: p.queueLength === 0 ? 'idle' :
                  p.queueLength < 10 ? 'normal' :
                  p.queueLength < 50 ? 'busy' : 'overloaded'
        }))
      };

      return {
        success: true,
        data: details
      };
    } catch (error) {
      console.error("Failed to get queue details:", error);
      reply.status(500).send({ error: "Failed to get queue details" });
    }
  });

  // Health check for Shin Mode
  server.get("/api/shin/health", async (req, reply) => {
    try {
      const stats = shinModeManager.getStats();
      
      // Check if any queue is overloaded
      const overloadedQueues = stats.providers.filter(p => p.queueLength > 50);
      const longWaitQueues = stats.providers.filter(p => p.longestWaitTime > 30000);
      
      const isHealthy = overloadedQueues.length === 0 && longWaitQueues.length === 0;

      return {
        success: true,
        data: {
          healthy: isHealthy,
          mode: stats.mode,
          issues: [
            ...overloadedQueues.map(q => ({
              type: 'overloaded',
              provider: q.provider,
              queueLength: q.queueLength
            })),
            ...longWaitQueues.map(q => ({
              type: 'long_wait',
              provider: q.provider,
              longestWait: Math.round(q.longestWaitTime)
            }))
          ]
        }
      };
    } catch (error) {
      console.error("Failed to get health:", error);
      reply.status(500).send({ error: "Failed to get health" });
    }
  });

  // Real-time queue monitoring (SSE)
  server.get("/api/shin/stream", async (req, reply) => {
    try {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      // Send initial data
      const initialStats = shinModeManager.getStats();
      reply.raw.write(`data: ${JSON.stringify(initialStats)}\n\n`);

      // Subscribe to queue updates
      const onQueueUpdate = () => {
        const stats = shinModeManager.getStats();
        reply.raw.write(`data: ${JSON.stringify(stats)}\n\n`);
      };

      shinModeManager.on('requestQueued', onQueueUpdate);
      shinModeManager.on('requestProcessing', onQueueUpdate);
      shinModeManager.on('requestCompleted', onQueueUpdate);

      // Send periodic updates
      const interval = setInterval(() => {
        try {
          const stats = shinModeManager.getStats();
          reply.raw.write(`data: ${JSON.stringify(stats)}\n\n`);
        } catch (error) {
          clearInterval(interval);
          shinModeManager.removeListener('requestQueued', onQueueUpdate);
          shinModeManager.removeListener('requestProcessing', onQueueUpdate);
          shinModeManager.removeListener('requestCompleted', onQueueUpdate);
        }
      }, 1000); // Every second

      // Cleanup on disconnect
      req.raw.on('close', () => {
        clearInterval(interval);
        shinModeManager.removeListener('requestQueued', onQueueUpdate);
        shinModeManager.removeListener('requestProcessing', onQueueUpdate);
        shinModeManager.removeListener('requestCompleted', onQueueUpdate);
      });

    } catch (error) {
      console.error("Failed to setup Shin Mode stream:", error);
      reply.status(500).send({ error: "Failed to setup stream" });
    }
  });

  console.log('[SHIN-MODE] Management endpoints registered');
}
