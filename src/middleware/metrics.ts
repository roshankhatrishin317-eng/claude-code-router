import { FastifyRequest, FastifyReply } from "fastify";
import { metricsCollector, RequestMetrics } from "../utils/metrics";
import { realTimeTokenTracker } from "../utils/realTimeTokenTracker";

export const metricsMiddleware = async (req: FastifyRequest, reply: FastifyReply) => {
  // Only track API requests
  if (!req.url.startsWith('/v1/') || req.method !== 'POST') {
    return;
  }

  const startTime = Date.now();

  // Extract session ID from request headers or metadata
  let sessionId: string | undefined;
  const body = req.body as any;

  if (body.metadata?.user_id) {
    const parts = body.metadata.user_id.split("_session_");
    if (parts.length > 1) {
      sessionId = parts[1];
    }
  }

  // Generate unique request ID if no session
  if (!sessionId) {
    sessionId = `req-${startTime}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Extract provider and model from request for later use
  let provider = 'unknown';
  let model = 'unknown';

  if (body?.model) {
    if (typeof body.model === 'string' && body.model.includes(',')) {
      [provider, model] = body.model.split(',');
    } else {
      model = body.model;
    }
  }

  // Store enhanced metrics context
  (req as any).__metricsContext = {
    startTime,
    sessionId,
    provider,
    model
  };

  // Intercept response to capture token usage in real-time
  const originalSend = reply.raw.send;
  reply.raw.send = function(data: any) {
    try {
      // Try to extract token usage from response
      let inputTokens = 0;
      let outputTokens = 0;

      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          if (parsed.usage) {
            inputTokens = parsed.usage.input_tokens || 0;
            outputTokens = parsed.usage.output_tokens || 0;
          }
        } catch (e) {
          // Not JSON, ignore
        }
      } else if (data && typeof data === 'object') {
        if (data.usage) {
          inputTokens = data.usage.input_tokens || 0;
          outputTokens = data.usage.output_tokens || 0;
        }
      }

      // Real-time token tracking with advanced tracker
      if (inputTokens > 0 || outputTokens > 0) {
        realTimeTokenTracker.addTokenData(sessionId, inputTokens, outputTokens);
      }

    } catch (error) {
      console.error('Error in response interceptor:', error);
    }

    return originalSend.call(this, data);
  };
};

// Response metrics collector to be used with onResponse hook
export const collectResponseMetrics = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const metricsContext = (req as any).__metricsContext;
    if (!metricsContext) return;

    const { startTime, sessionId, provider, model } = metricsContext;
    const duration = Date.now() - startTime;

    // Extract token usage from response or session cache
    let inputTokens = 0;
    let outputTokens = 0;
    let success = reply.statusCode < 400;
    let errorType = undefined;

    // Try to get token usage from session cache first
    if (sessionId) {
      try {
        const { sessionUsageCache } = await import('../utils/cache');
        const usage = sessionUsageCache.get(sessionId);
        if (usage) {
          inputTokens = usage.input_tokens || 0;
          outputTokens = usage.output_tokens || 0;
        }
      } catch (cacheError) {
        // Ignore cache errors
      }
    }

    const metrics: RequestMetrics = {
      timestamp: startTime,
      sessionId,
      provider,
      model,
      inputTokens,
      outputTokens,
      duration,
      success,
      errorType
    };

    metricsCollector.recordRequest(metrics);
  } catch (error) {
    console.error('Error collecting metrics:', error);
    // Don't let metrics errors break the request
  }
};

// Stream processing metrics
export const trackStreamMetrics = (req: FastifyRequest, startTime: number) => {
  return async (data: any) => {
    // This can be used to track streaming response metrics
    if (data.event === 'message_delta' && data.usage) {
      const sessionId = (req as any).sessionId;
      let provider = 'unknown';
      let model = 'unknown';

      if (req.body?.model) {
        if (typeof req.body.model === 'string' && req.body.model.includes(',')) {
          [provider, model] = req.body.model.split(',');
        } else {
          model = req.body.model;
        }
      }

      const metrics: RequestMetrics = {
        timestamp: startTime,
        sessionId,
        provider,
        model,
        inputTokens: data.usage.input_tokens || 0,
        outputTokens: data.usage.output_tokens || 0,
        duration: Date.now() - startTime,
        success: true
      };

      metricsCollector.recordRequest(metrics);
    }
  };
};