import { FastifyRequest, FastifyReply } from "fastify";
import { metricsCollector, RequestMetrics } from "../utils/metrics";

export const metricsMiddleware = async (req: FastifyRequest, reply: FastifyReply) => {
  // Only track API requests
  if (!req.url.startsWith('/v1/') || req.method !== 'POST') {
    return;
  }

  const startTime = Date.now();
  const sessionId = (req as any).sessionId;

  // Extract provider and model from request
  let provider = 'unknown';
  let model = 'unknown';

  if (req.body?.model) {
    if (typeof req.body.model === 'string' && req.body.model.includes(',')) {
      [provider, model] = req.body.model.split(',');
    } else {
      model = req.body.model;
    }
  }

  // Hook into response to collect metrics
  reply.addHook('onSend', async (request, reply, payload) => {
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Extract token usage from response or session cache
    let inputTokens = 0;
    let outputTokens = 0;
    let success = true;
    let errorType = undefined;

    if (payload && typeof payload === 'object') {
      if (payload.usage) {
        inputTokens = payload.usage.input_tokens || 0;
        outputTokens = payload.usage.output_tokens || 0;
      }
      if (payload.error) {
        success = false;
        errorType = payload.error.type || 'unknown';
      }
    }

    // If no token info in payload, try to get from session usage cache
    if (inputTokens === 0 && outputTokens === 0 && sessionId) {
      const { sessionUsageCache } = await import('../utils/cache');
      const usage = sessionUsageCache.get(sessionId);
      if (usage) {
        inputTokens = usage.input_tokens || 0;
        outputTokens = usage.output_tokens || 0;
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
  });
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