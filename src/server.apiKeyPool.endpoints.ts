/**
 * API Key Pool Management Endpoints
 * 
 * REST API endpoints for managing and monitoring the API key pool
 */

import { FastifyInstance } from 'fastify';
import { apiKeyPool } from './utils/apiKeyPool';

export function registerApiKeyPoolEndpoints(server: FastifyInstance) {
  // Get pool statistics
  server.get("/api/apikeys/stats", async (req, reply) => {
    try {
      const provider = (req.query as any).provider;
      const stats = apiKeyPool.getStats(provider);
      
      return {
        success: true,
        data: stats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error("Failed to get API key pool stats:", error);
      reply.status(500).send({ error: "Failed to get API key pool stats" });
    }
  });

  // Get health status of all keys
  server.get("/api/apikeys/health", async (req, reply) => {
    try {
      const stats = apiKeyPool.getStats();
      const providers: string[] = [];
      
      // Get unique providers
      const allMetrics = Array.from((apiKeyPool as any).metrics.values());
      allMetrics.forEach((metric: any) => {
        if (!providers.includes(metric.provider)) {
          providers.push(metric.provider);
        }
      });

      const healthByProvider: any = {};
      
      for (const provider of providers) {
        const providerStats = apiKeyPool.getStats(provider);
        const keys = apiKeyPool.getProviderKeys(provider);
        
        healthByProvider[provider] = {
          totalKeys: providerStats.totalKeys,
          healthyKeys: providerStats.healthyKeys,
          degradedKeys: providerStats.degradedKeys,
          rateLimitedKeys: providerStats.rateLimitedKeys,
          unavailableKeys: providerStats.unavailableKeys,
          averageHealthScore: providerStats.averageHealthScore,
          keys: keys.map(key => {
            const keyHash = (apiKeyPool as any).hashKey(key.key);
            const metrics = apiKeyPool.getKeyMetrics(keyHash);
            return {
              key: (apiKeyPool as any).maskKey(key.key),
              enabled: key.enabled,
              priority: key.priority,
              health: metrics?.health || 'unknown',
              healthScore: metrics?.healthScore || 0,
              requestCount: metrics?.requestCount || 0,
              errorCount: metrics?.errorCount || 0,
              lastUsed: metrics?.lastUsed || null,
            };
          })
        };
      }

      return {
        success: true,
        data: healthByProvider,
        summary: {
          totalKeys: stats.totalKeys,
          healthyKeys: stats.healthyKeys,
          overallHealthScore: stats.averageHealthScore
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error("Failed to get API key health:", error);
      reply.status(500).send({ error: "Failed to get API key health" });
    }
  });

  // Get current rotation strategy
  server.get("/api/apikeys/strategy", async (req, reply) => {
    try {
      const strategy = apiKeyPool.getStrategy();
      
      return {
        success: true,
        data: {
          current: strategy,
          available: ['round-robin', 'lru', 'least-loaded', 'weighted']
        }
      };
    } catch (error) {
      console.error("Failed to get strategy:", error);
      reply.status(500).send({ error: "Failed to get strategy" });
    }
  });

  // Change rotation strategy
  server.post("/api/apikeys/strategy", async (req, reply) => {
    try {
      const { strategy } = req.body as any;
      
      if (!['round-robin', 'lru', 'least-loaded', 'weighted'].includes(strategy)) {
        reply.status(400).send({ error: "Invalid strategy. Must be one of: round-robin, lru, least-loaded, weighted" });
        return;
      }

      apiKeyPool.setStrategy(strategy);
      
      return {
        success: true,
        message: `Strategy changed to ${strategy}`,
        data: { strategy }
      };
    } catch (error) {
      console.error("Failed to set strategy:", error);
      reply.status(500).send({ error: "Failed to set strategy" });
    }
  });

  // Force health check
  server.post("/api/apikeys/health-check", async (req, reply) => {
    try {
      await apiKeyPool.checkHealth();
      
      return {
        success: true,
        message: "Health check completed",
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error("Failed to run health check:", error);
      reply.status(500).send({ error: "Failed to run health check" });
    }
  });

  // Add new key to pool
  server.post("/api/apikeys/add", async (req, reply) => {
    try {
      const keyConfig = req.body as any;
      
      if (!keyConfig.key || !keyConfig.provider) {
        reply.status(400).send({ error: "Missing required fields: key, provider" });
        return;
      }

      apiKeyPool.addKey({
        key: keyConfig.key,
        provider: keyConfig.provider,
        rateLimit: keyConfig.rateLimit,
        priority: keyConfig.priority || 10,
        enabled: keyConfig.enabled ?? true,
        tags: keyConfig.tags
      });
      
      return {
        success: true,
        message: `Key added for provider ${keyConfig.provider}`
      };
    } catch (error) {
      console.error("Failed to add key:", error);
      reply.status(500).send({ error: "Failed to add key" });
    }
  });

  // Remove key from pool
  server.post("/api/apikeys/remove", async (req, reply) => {
    try {
      const { provider, key } = req.body as any;
      
      if (!provider || !key) {
        reply.status(400).send({ error: "Missing required fields: provider, key" });
        return;
      }

      const removed = apiKeyPool.removeKey(provider, key);
      
      if (removed) {
        return {
          success: true,
          message: `Key removed from provider ${provider}`
        };
      } else {
        reply.status(404).send({ error: "Key not found" });
        return;
      }
    } catch (error) {
      console.error("Failed to remove key:", error);
      reply.status(500).send({ error: "Failed to remove key" });
    }
  });

  // Get detailed metrics for a specific provider
  server.get("/api/apikeys/provider/:provider", async (req, reply) => {
    try {
      const provider = (req.params as any).provider;
      const keys = apiKeyPool.getProviderKeys(provider);
      const stats = apiKeyPool.getStats(provider);
      
      const detailedKeys = keys.map(key => {
        const keyHash = (apiKeyPool as any).hashKey(key.key);
        const metrics = apiKeyPool.getKeyMetrics(keyHash);
        return {
          key: (apiKeyPool as any).maskKey(key.key),
          config: {
            priority: key.priority,
            enabled: key.enabled,
            tags: key.tags,
            rateLimit: key.rateLimit
          },
          metrics: metrics ? {
            requestCount: metrics.requestCount,
            tokenCount: metrics.tokenCount,
            errorCount: metrics.errorCount,
            successCount: metrics.successCount,
            rateLimitCount: metrics.rateLimitCount,
            health: metrics.health,
            healthScore: metrics.healthScore,
            averageLatency: metrics.averageLatency,
            lastUsed: metrics.lastUsed,
            lastError: metrics.lastError,
            rateLimitResetTime: metrics.rateLimitResetTime
          } : null
        };
      });

      return {
        success: true,
        data: {
          provider,
          stats,
          keys: detailedKeys
        }
      };
    } catch (error) {
      console.error("Failed to get provider details:", error);
      reply.status(500).send({ error: "Failed to get provider details" });
    }
  });

  // Force rotate to next key (useful for testing)
  server.post("/api/apikeys/rotate", async (req, reply) => {
    try {
      const { provider } = req.body as any;
      
      if (!provider) {
        reply.status(400).send({ error: "Missing required field: provider" });
        return;
      }

      const selectedKey = apiKeyPool.getKey(provider, 0);
      
      if (selectedKey) {
        return {
          success: true,
          message: "Key rotation successful",
          data: {
            selectedKey: selectedKey.metrics.key,
            health: selectedKey.metrics.health
          }
        };
      } else {
        return {
          success: false,
          message: "No keys available for rotation"
        };
      }
    } catch (error) {
      console.error("Failed to rotate key:", error);
      reply.status(500).send({ error: "Failed to rotate key" });
    }
  });

  // Get usage distribution across keys
  server.get("/api/apikeys/distribution", async (req, reply) => {
    try {
      const provider = (req.query as any).provider;
      const stats = apiKeyPool.getStats(provider);
      
      return {
        success: true,
        data: {
          utilization: stats.keyUtilization,
          totalRequests: stats.totalRequests,
          totalErrors: stats.totalErrors,
          errorRate: stats.totalRequests > 0 
            ? (stats.totalErrors / stats.totalRequests * 100).toFixed(2) + '%'
            : '0%'
        }
      };
    } catch (error) {
      console.error("Failed to get distribution:", error);
      reply.status(500).send({ error: "Failed to get distribution" });
    }
  });

  console.log('[API-KEY-POOL] Management endpoints registered');
}
