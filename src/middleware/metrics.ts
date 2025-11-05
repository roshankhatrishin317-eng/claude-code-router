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

  // Extract IP address and user agent
  const ipAddress = req.ip || req.headers['x-forwarded-for'] as string || req.headers['x-real-ip'] as string || 'unknown';
  const userAgent = req.headers['user-agent'] as string || 'unknown';

  // Store enhanced metrics context
  (req as any).__metricsContext = {
    startTime,
    sessionId,
    provider,
    model,
    ipAddress,
    userAgent
  };
};

// Response metrics collector to be used with onResponse hook
export const collectResponseMetrics = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    console.log(`[COLLECT-RESPONSE] onResponse hook called for ${req.url}`);

    const metricsContext = (req as any).__metricsContext;
    if (!metricsContext) return;

    const { startTime, sessionId, provider, model, ipAddress, userAgent } = metricsContext;
    const duration = Date.now() - startTime;
    const statusCode = reply.statusCode;

    // Extract token usage from response or session cache with enhanced logic
    let inputTokens = 0;
    let outputTokens = 0;
    let success = statusCode < 400;
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

    // If no tokens from cache, try to extract from response
    if (inputTokens === 0 && outputTokens === 0) {
      try {
        console.log(`[COLLECT-RESPONSE] reply object keys: ${Object.keys(reply).join(', ')}`);

        // Try to get response data from reply body or context
        let responseData = (reply as any)._responseData;
        console.log(`[COLLECT-RESPONSE] reply._responseData: ${!!responseData}`);

        // Also try to get from request context (set by response interceptor)
        if (!responseData && (req as any).__responseData) {
          responseData = (req as any).__responseData;
          console.log(`[COLLECT-RESPONSE] req.__responseData found`);
        } else {
          console.log(`[COLLECT-RESPONSE] req.__responseData not found`);
        }

        if (responseData) {
          console.log(`[COLLECT-RESPONSE] Response data type: ${typeof responseData}, has usage: ${!!(responseData.usage)}`);
          const extractedTokens = extractTokensWithFallback(responseData);
          inputTokens = extractedTokens.inputTokens;
          outputTokens = extractedTokens.outputTokens;
          console.log(`[COLLECT-RESPONSE] Extracted tokens: input=${inputTokens}, output=${outputTokens}`);
        }
      } catch (extractError) {
        console.error(`[COLLECT-RESPONSE] Extract error:`, extractError);
        // Ignore extraction errors
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
      errorType,
      statusCode,
      ipAddress,
      userAgent
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

/**
 * Enhanced token extraction for all LLM provider formats
 * Handles OpenAI, Anthropic, DeepSeek, and other providers
 */
export function extractTokensFromResponse(response: any): { inputTokens: number; outputTokens: number } | null {
  if (!response || !response.usage) {
    return null;
  }

  const usage = response.usage;
  let inputTokens = 0;
  let outputTokens = 0;

  // OpenAI format: prompt_tokens, completion_tokens
  if (usage.prompt_tokens !== undefined) {
    inputTokens = usage.prompt_tokens;
  } else if (usage.input_tokens !== undefined) {
    inputTokens = usage.input_tokens;
  } else if (usage.promptTokenCount !== undefined) {
    inputTokens = usage.promptTokenCount;
  }

  // Output tokens - multiple possible field names
  if (usage.completion_tokens !== undefined) {
    outputTokens = usage.completion_tokens;
  } else if (usage.output_tokens !== undefined) {
    outputTokens = usage.output_tokens;
  } else if (usage.completionTokenCount !== undefined) {
    outputTokens = usage.completionTokenCount;
  } else if (usage.max_output_tokens !== undefined) {
    outputTokens = usage.max_output_tokens;
  }

  // If we found tokens, return them
  if (inputTokens > 0 || outputTokens > 0) {
    return { inputTokens, outputTokens };
  }

  return null;
}

/**
 * Extract tokens from streaming responses
 * Handles SSE streams and chunked responses
 */
export function extractTokensFromStreaming(data: any): { inputTokens: number; outputTokens: number } | null {
  try {
    // Handle Server-Sent Events (SSE) format
    if (typeof data === 'string') {
      // SSE format: "data: {...}\n\n"
      if (data.startsWith('data: ')) {
        const jsonStr = data.replace(/^data: /, '').trim();
        if (jsonStr === '[DONE]') {
          return null;
        }

        try {
          const parsed = JSON.parse(jsonStr);
          return extractTokensFromResponse(parsed);
        } catch (e) {
          // Invalid JSON in SSE data
        }
      }
    }

    // Handle chunked streaming responses
    if (data && typeof data === 'object') {
      // Look for usage in streaming chunks
      if (data.usage) {
        return extractTokensFromResponse(data);
      }

      // Some providers send usage in delta
      if (data.delta && data.delta.usage) {
        return extractTokensFromResponse({ usage: data.delta.usage });
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Fallback token estimation based on text length
 * Used when exact token counts are not available
 */
function estimateTokensFromText(text: string): number {
  if (!text) return 0;

  // Rough estimation: ~4 characters per token for English text
  // This is a fallback when exact token counts aren't available
  const estimatedTokens = Math.ceil(text.length / 4);
  return estimatedTokens;
}

/**
 * Enhanced token extraction with fallback estimation
 * Tries multiple strategies to get token counts
 */
export function extractTokensWithFallback(response: any): { inputTokens: number; outputTokens: number } {
  // First try exact extraction
  let result = extractTokensFromResponse(response);
  if (result) {
    return result;
  }

  // Try streaming extraction
  result = extractTokensFromStreaming(response);
  if (result) {
    return result;
  }

  // Fallback: estimate from text content
  let inputText = '';
  let outputText = '';

  if (response.messages) {
    // Extract input text from messages
    for (const msg of response.messages) {
      if (msg.content) {
        inputText += typeof msg.content === 'string' ? msg.content : '';
      }
    }
  }

  if (response.choices && response.choices[0] && response.choices[0].message) {
    outputText = response.choices[0].message.content || '';
  }

  const inputTokens = estimateTokensFromText(inputText);
  const outputTokens = estimateTokensFromText(outputText);

  return { inputTokens, outputTokens };
}
