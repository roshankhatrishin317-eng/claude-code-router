/**
 * HTTP Connection Pool Management Endpoints
 * 
 * REST API endpoints for monitoring and managing the HTTP connection pool
 */

import { FastifyInstance } from 'fastify';
import { httpConnectionPool } from './utils/httpConnectionPool';

export function registerHttpConnectionPoolEndpoints(server: FastifyInstance) {
  // Get overall pool statistics
  server.get("/api/connections/stats", async (req, reply) => {
    try {
      const stats = httpConnectionPool.getStats();
      
      return {
        success: true,
        data: stats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error("Failed to get connection pool stats:", error);
      reply.status(500).send({ error: "Failed to get connection pool stats" });
    }
  });

  // Get statistics for a specific provider
  server.get("/api/connections/provider/:provider", async (req, reply) => {
    try {
      const provider = (req.params as any).provider;
      const stats = httpConnectionPool.getStats(provider);
      
      if (!stats) {
        reply.status(404).send({ error: `No connections found for provider ${provider}` });
        return;
      }

      return {
        success: true,
        data: stats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error("Failed to get provider stats:", error);
      reply.status(500).send({ error: "Failed to get provider stats" });
    }
  });

  // Get list of providers with active connections
  server.get("/api/connections/providers", async (req, reply) => {
    try {
      const providers = httpConnectionPool.getProviders();
      
      return {
        success: true,
        data: {
          providers,
          count: providers.length
        }
      };
    } catch (error) {
      console.error("Failed to get providers:", error);
      reply.status(500).send({ error: "Failed to get providers" });
    }
  });

  // Get connection pool health
  server.get("/api/connections/health", async (req, reply) => {
    try {
      const stats: any = httpConnectionPool.getStats();
      
      // Determine health based on metrics
      const issues = [];
      
      // Check for too many idle connections
      if (stats.totalIdleConnections > 50) {
        issues.push({
          type: 'high_idle_connections',
          message: `High number of idle connections: ${stats.totalIdleConnections}`,
          severity: 'warning'
        });
      }

      // Check for low reuse rate
      if (stats.overallReuseRate < 50 && stats.totalRequests > 10) {
        issues.push({
          type: 'low_reuse_rate',
          message: `Low connection reuse rate: ${stats.overallReuseRate.toFixed(2)}%`,
          severity: 'info'
        });
      }

      const isHealthy = issues.filter(i => i.severity === 'error').length === 0;

      return {
        success: true,
        data: {
          healthy: isHealthy,
          totalConnections: stats.totalActiveConnections + stats.totalIdleConnections,
          activeConnections: stats.totalActiveConnections,
          idleConnections: stats.totalIdleConnections,
          reuseRate: stats.overallReuseRate,
          issues
        }
      };
    } catch (error) {
      console.error("Failed to get health:", error);
      reply.status(500).send({ error: "Failed to get health" });
    }
  });

  // Destroy connections for a specific provider
  server.post("/api/connections/destroy/:provider", async (req, reply) => {
    try {
      const provider = (req.params as any).provider;
      const { protocol } = req.body as any;
      
      if (!httpConnectionPool.hasProvider(provider)) {
        reply.status(404).send({ error: `No connections found for provider ${provider}` });
        return;
      }

      httpConnectionPool.destroyProvider(provider, protocol);
      
      return {
        success: true,
        message: `Destroyed connections for provider ${provider}`,
        data: { provider, protocol }
      };
    } catch (error) {
      console.error("Failed to destroy provider:", error);
      reply.status(500).send({ error: "Failed to destroy provider" });
    }
  });

  // Get detailed connection information
  server.get("/api/connections/details", async (req, reply) => {
    try {
      const stats: any = httpConnectionPool.getStats();
      
      const details = {
        overview: {
          totalProviders: stats.totalProviders,
          totalActiveConnections: stats.totalActiveConnections,
          totalIdleConnections: stats.totalIdleConnections,
          totalRequests: stats.totalRequests,
          overallReuseRate: Math.round(stats.overallReuseRate * 100) / 100
        },
        providers: stats.providers.map((p: any) => ({
          provider: p.provider,
          protocol: p.protocol,
          connections: {
            active: p.activeConnections,
            idle: p.idleConnections,
            total: p.activeConnections + p.idleConnections
          },
          performance: {
            totalRequests: p.totalRequests,
            reuseCount: p.reuseCount,
            reuseRate: Math.round(p.reuseRate * 100) / 100,
            averageConnectionAge: Math.round(p.averageConnectionAge / 1000) // seconds
          },
          status: p.activeConnections > 0 ? 'active' : 
                  p.idleConnections > 0 ? 'idle' : 'inactive'
        }))
      };

      return {
        success: true,
        data: details
      };
    } catch (error) {
      console.error("Failed to get details:", error);
      reply.status(500).send({ error: "Failed to get details" });
    }
  });

  // Real-time connection monitoring (SSE)
  server.get("/api/connections/stream", async (req, reply) => {
    try {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      // Send initial data
      const initialStats = httpConnectionPool.getStats();
      reply.raw.write(`data: ${JSON.stringify(initialStats)}\n\n`);

      // Send periodic updates
      const interval = setInterval(() => {
        try {
          const stats = httpConnectionPool.getStats();
          reply.raw.write(`data: ${JSON.stringify(stats)}\n\n`);
        } catch (error) {
          clearInterval(interval);
        }
      }, 2000); // Every 2 seconds

      // Cleanup on disconnect
      req.raw.on('close', () => {
        clearInterval(interval);
      });

    } catch (error) {
      console.error("Failed to setup connection stream:", error);
      reply.status(500).send({ error: "Failed to setup stream" });
    }
  });

  console.log('[HTTP-POOL] Management endpoints registered');
}
