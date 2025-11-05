import { FastifyRequest, FastifyReply } from "fastify";
import { metricsCollector, RequestMetrics } from "../utils/metrics";
import { realTimeTokenTracker } from "../utils/realTimeTokenTracker";
import { universalTokenExtractor } from "../utils/universalTokenExtractor";

export const metricsMiddleware = async (req: FastifyRequest, reply: FastifyReply) => {
  // Only track API requests
  if (!req.url.startsWith('/v1/') || req.method !== 'POST') {
    return;
  }

  const startTime = Date.now();

  // Extract session ID - use the same logic as index.ts
  let sessionId: string | undefined = (req as any).sessionId;
  
  // If no sessionId on request object, try to extract from body
  if (!sessionId) {
    const body = req.body as any;
    if (body?.metadata?.user_id) {
      const parts = body.metadata.user_id.split("_session_");
      if (parts.length > 1) {
        sessionId = parts[1];
      }
    }

    // Generate unique request ID if no session
    if (!sessionId) {
      sessionId = `req-${startTime}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Store on request for consistency
    (req as any).sessionId = sessionId;
  }

  // Extract provider and model from request for later use
  let provider = 'unknown';
  let model = 'unknown';

  const body = req.body as any;
  if (body?.model) {
    if (typeof body.model === 'string' && body.model.includes(',')) {
      [provider, model] = body.model.split(',');
    } else {
      model = body.model;
      // Try to infer provider from model name
      provider = inferProviderFromModel(model);
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

  console.log(`[METRICS-MIDDLEWARE] Initialized context for ${req.url}, session: ${sessionId}, provider: ${provider}, model: ${model}`);
};

// Response metrics collector to be used with onResponse hook
export const collectResponseMetrics = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    // Only process API requests
    if (!req.url.startsWith('/v1/') || req.method !== 'POST') {
      return;
    }

    const metricsContext = (req as any).__metricsContext;
    if (!metricsContext) {
      console.log(`[COLLECT-RESPONSE] No metrics context for ${req.url}`);
      return;
    }

    const { startTime, sessionId, provider, model, ipAddress, userAgent } = metricsContext;
    const duration = Date.now() - startTime;
    const statusCode = reply.statusCode;

    // Extract token usage from response or session cache with enhanced logic
    let inputTokens = 0;
    let outputTokens = 0;
    let success = statusCode < 400;
    let errorType = undefined;

    if (!success) {
      errorType = statusCode === 429 ? 'rate_limit' : 
                  statusCode === 401 ? 'unauthorized' :
                  statusCode === 403 ? 'forbidden' :
                  statusCode >= 500 ? 'server_error' : 'client_error';
    }

    // Try to get token usage from session cache first
    if (sessionId) {
      try {
        const { sessionUsageCache } = await import('../utils/cache');
        const usage = sessionUsageCache.get(sessionId);
        if (usage) {
          inputTokens = usage.input_tokens || 0;
          outputTokens = usage.output_tokens || 0;
          console.log(`[COLLECT-RESPONSE] Tokens from cache: input=${inputTokens}, output=${outputTokens}`);
        }
      } catch (cacheError) {
        console.warn(`[COLLECT-RESPONSE] Cache error:`, cacheError);
      }
    }

    // If no tokens from cache, try to extract from response
    if (inputTokens === 0 && outputTokens === 0) {
      try {
        // Try to get response data from reply body or context
        let responseData = (reply as any)._responseData || (req as any).__responseData;

        if (responseData) {
          console.log(`[COLLECT-RESPONSE] Response data found for ${provider}, type: ${typeof responseData}`);
          
          // Use Universal Token Extractor (works for ANY provider)
          const universalResult = universalTokenExtractor.extract(responseData, provider);
          inputTokens = universalResult.inputTokens;
          outputTokens = universalResult.outputTokens;
          
          console.log(`[COLLECT-RESPONSE] Universal extraction for ${provider}: input=${inputTokens}, output=${outputTokens}, confidence=${universalResult.confidence}, source=${universalResult.source}`);
          
          // If confidence is low, try legacy fallback
          if (universalResult.confidence === 'low' && (inputTokens === 0 || outputTokens === 0)) {
            console.log(`[COLLECT-RESPONSE] Low confidence, trying legacy fallback for ${provider}`);
            const legacyTokens = extractTokensWithFallback(responseData, provider);
            if (legacyTokens.inputTokens > inputTokens || legacyTokens.outputTokens > outputTokens) {
              inputTokens = legacyTokens.inputTokens;
              outputTokens = legacyTokens.outputTokens;
              console.log(`[COLLECT-RESPONSE] Legacy fallback improved result: input=${inputTokens}, output=${outputTokens}`);
            }
          }
        } else {
          console.log(`[COLLECT-RESPONSE] No response data available for ${provider}`);
          
          // Last resort: try to parse from reply raw response
          if ((reply as any).raw) {
            console.log(`[COLLECT-RESPONSE] Attempting to parse from raw response for ${provider}`);
            try {
              const rawBody = (reply as any).raw;
              if (typeof rawBody === 'string') {
                const parsed = JSON.parse(rawBody);
                const universalResult = universalTokenExtractor.extract(parsed, provider);
                inputTokens = universalResult.inputTokens;
                outputTokens = universalResult.outputTokens;
                console.log(`[COLLECT-RESPONSE] Extracted from raw: input=${inputTokens}, output=${outputTokens}, confidence=${universalResult.confidence}`);
              }
            } catch (parseError) {
              console.warn(`[COLLECT-RESPONSE] Could not parse raw response:`, parseError);
            }
          }
        }
      } catch (extractError) {
        console.error(`[COLLECT-RESPONSE] Extract error for ${provider}:`, extractError);
      }
    }

    // Record metrics even if we couldn't extract tokens (important for error tracking)
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

    console.log(`[COLLECT-RESPONSE] Recording metrics: ${JSON.stringify(metrics)}`);
    metricsCollector.recordRequest(metrics);

    // Update real-time token tracker if tokens were found
    if (inputTokens > 0 || outputTokens > 0) {
      const { realTimeTokenTracker } = await import('../utils/realTimeTokenTracker');
      realTimeTokenTracker.addTokenData(sessionId || 'unknown', inputTokens, outputTokens);
    }
  } catch (error) {
    console.error('[COLLECT-RESPONSE] Error collecting metrics:', error);
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
 * Handles OpenAI, Anthropic, DeepSeek, NVIDIA, and other providers
 */
export function extractTokensFromResponse(response: any): { inputTokens: number; outputTokens: number } | null {
  if (!response) {
    return null;
  }

  // Check if usage exists at top level or nested
  const usage = response.usage || response.token_usage || response.usage_metadata;
  
  if (!usage) {
    // Some providers might have tokens at root level
    if (response.prompt_tokens !== undefined || response.input_tokens !== undefined) {
      return extractTokensDirectly(response);
    }
    return null;
  }

  let inputTokens = 0;
  let outputTokens = 0;

  // Try all known input token field names
  // OpenAI/NVIDIA: prompt_tokens
  // Anthropic: input_tokens
  // Google: promptTokenCount
  // Alternative formats: prompt_token_count, num_prompt_tokens
  if (usage.prompt_tokens !== undefined) {
    inputTokens = usage.prompt_tokens;
  } else if (usage.input_tokens !== undefined) {
    inputTokens = usage.input_tokens;
  } else if (usage.promptTokenCount !== undefined) {
    inputTokens = usage.promptTokenCount;
  } else if (usage.prompt_token_count !== undefined) {
    inputTokens = usage.prompt_token_count;
  } else if (usage.num_prompt_tokens !== undefined) {
    inputTokens = usage.num_prompt_tokens;
  } else if (usage.inputTokens !== undefined) {
    inputTokens = usage.inputTokens;
  }

  // Try all known output token field names
  // OpenAI/NVIDIA: completion_tokens
  // Anthropic: output_tokens
  // Google: completionTokenCount, candidatesTokenCount
  // Alternative formats: completion_token_count, num_completion_tokens
  if (usage.completion_tokens !== undefined) {
    outputTokens = usage.completion_tokens;
  } else if (usage.output_tokens !== undefined) {
    outputTokens = usage.output_tokens;
  } else if (usage.completionTokenCount !== undefined) {
    outputTokens = usage.completionTokenCount;
  } else if (usage.candidatesTokenCount !== undefined) {
    outputTokens = usage.candidatesTokenCount;
  } else if (usage.completion_token_count !== undefined) {
    outputTokens = usage.completion_token_count;
  } else if (usage.num_completion_tokens !== undefined) {
    outputTokens = usage.num_completion_tokens;
  } else if (usage.outputTokens !== undefined) {
    outputTokens = usage.outputTokens;
  } else if (usage.max_output_tokens !== undefined) {
    outputTokens = usage.max_output_tokens;
  }

  // Some providers give total_tokens, try to derive if needed
  if ((inputTokens === 0 || outputTokens === 0) && usage.total_tokens !== undefined) {
    const totalTokens = usage.total_tokens || usage.totalTokens;
    if (inputTokens > 0 && outputTokens === 0) {
      outputTokens = totalTokens - inputTokens;
    } else if (outputTokens > 0 && inputTokens === 0) {
      inputTokens = totalTokens - outputTokens;
    }
  }

  // Log extraction for debugging
  if (inputTokens > 0 || outputTokens > 0) {
    console.log(`[TOKEN-EXTRACT] Found tokens - input: ${inputTokens}, output: ${outputTokens}, source: usage object`);
    return { inputTokens, outputTokens };
  }

  return null;
}

/**
 * Extract tokens directly from response root (some providers don't nest in usage)
 */
function extractTokensDirectly(response: any): { inputTokens: number; outputTokens: number } | null {
  let inputTokens = 0;
  let outputTokens = 0;

  // Try direct fields
  if (response.prompt_tokens !== undefined) {
    inputTokens = response.prompt_tokens;
  } else if (response.input_tokens !== undefined) {
    inputTokens = response.input_tokens;
  }

  if (response.completion_tokens !== undefined) {
    outputTokens = response.completion_tokens;
  } else if (response.output_tokens !== undefined) {
    outputTokens = response.output_tokens;
  }

  if (inputTokens > 0 || outputTokens > 0) {
    console.log(`[TOKEN-EXTRACT] Found tokens - input: ${inputTokens}, output: ${outputTokens}, source: root object`);
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
 * Infer provider from model name
 * Useful when provider not explicitly specified
 */
function inferProviderFromModel(model: string): string {
  if (!model || typeof model !== 'string') return 'unknown';
  
  const modelLower = model.toLowerCase();
  
  // NVIDIA models
  if (modelLower.includes('nvidia') || 
      modelLower.includes('nemotron') ||
      modelLower.includes('nim/')) {
    return 'nvidia';
  }
  
  // OpenAI models
  if (modelLower.startsWith('gpt-') || 
      modelLower.includes('davinci') ||
      modelLower.includes('curie') ||
      modelLower.includes('babbage') ||
      modelLower.includes('ada')) {
    return 'openai';
  }
  
  // Anthropic models
  if (modelLower.includes('claude')) {
    return 'anthropic';
  }
  
  // Google models
  if (modelLower.includes('gemini') || 
      modelLower.includes('palm') ||
      modelLower.startsWith('bison') ||
      modelLower.startsWith('gecko')) {
    return 'google';
  }
  
  // DeepSeek models
  if (modelLower.includes('deepseek')) {
    return 'deepseek';
  }
  
  // Mistral models
  if (modelLower.includes('mistral') || modelLower.includes('mixtral')) {
    return 'mistral';
  }
  
  // Meta/Facebook models
  if (modelLower.includes('llama')) {
    return 'meta';
  }
  
  // Cohere models
  if (modelLower.includes('command') || modelLower.includes('cohere')) {
    return 'cohere';
  }
  
  // Default
  return 'unknown';
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
export function extractTokensWithFallback(response: any, provider?: string): { inputTokens: number; outputTokens: number } {
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

  // Provider-specific extraction attempts
  if (provider) {
    console.log(`[TOKEN-EXTRACT-FALLBACK] Attempting provider-specific extraction for ${provider}`);
    
    // NVIDIA-specific checks
    if (provider === 'nvidia' || provider.includes('nvidia')) {
      result = extractNvidiaTokens(response);
      if (result) {
        return result;
      }
    }
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
  } else if (response.content && Array.isArray(response.content)) {
    // Anthropic format
    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        outputText += block.text;
      }
    }
  }

  const inputTokens = estimateTokensFromText(inputText);
  const outputTokens = estimateTokensFromText(outputText);

  if (inputTokens > 0 || outputTokens > 0) {
    console.log(`[TOKEN-EXTRACT-FALLBACK] Estimated tokens from text: input=${inputTokens}, output=${outputTokens}`);
  }

  return { inputTokens, outputTokens };
}

/**
 * NVIDIA-specific token extraction
 * Handles NVIDIA NIM API response formats
 */
function extractNvidiaTokens(response: any): { inputTokens: number; outputTokens: number } | null {
  console.log(`[NVIDIA-TOKEN-EXTRACT] Attempting NVIDIA-specific extraction`);
  
  // NVIDIA NIM uses OpenAI-compatible format, but check all variations
  const possibleUsageLocations = [
    response.usage,
    response.token_usage,
    response.usage_metadata,
    response.metadata?.usage,
    response.result?.usage
  ];

  for (const usage of possibleUsageLocations) {
    if (usage) {
      const inputTokens = usage.prompt_tokens || usage.input_tokens || usage.promptTokens || 0;
      const outputTokens = usage.completion_tokens || usage.output_tokens || usage.completionTokens || 0;
      
      if (inputTokens > 0 || outputTokens > 0) {
        console.log(`[NVIDIA-TOKEN-EXTRACT] Found tokens: input=${inputTokens}, output=${outputTokens}`);
        return { inputTokens, outputTokens };
      }
    }
  }

  // Some NVIDIA endpoints might return token info in headers or metadata
  if (response.headers) {
    const inputTokens = parseInt(response.headers['x-prompt-tokens'] || response.headers['x-input-tokens'] || '0');
    const outputTokens = parseInt(response.headers['x-completion-tokens'] || response.headers['x-output-tokens'] || '0');
    
    if (inputTokens > 0 || outputTokens > 0) {
      console.log(`[NVIDIA-TOKEN-EXTRACT] Found tokens in headers: input=${inputTokens}, output=${outputTokens}`);
      return { inputTokens, outputTokens };
    }
  }

  console.log(`[NVIDIA-TOKEN-EXTRACT] No tokens found in NVIDIA response`);
  return null;
}
