/**
 * API Key Pool Middleware
 * 
 * Integrates API key pool with request processing
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { apiKeyPool, KeySelectionResult } from '../utils/apiKeyPool';

export interface ApiKeyPoolContext {
  selectedKey?: KeySelectionResult;
  estimatedTokens: number;
  startTime: number;
}

/**
 * Middleware to select API key from pool for outgoing requests
 */
export const apiKeyPoolMiddleware = async (req: FastifyRequest, reply: FastifyReply) => {
  // Only process API requests to providers
  if (!req.url.startsWith('/v1/') || req.method !== 'POST') {
    return;
  }

  const startTime = Date.now();
  const body = req.body as any;

  // Extract provider from request
  let provider = 'unknown';
  if (body?.model) {
    if (typeof body.model === 'string' && body.model.includes(',')) {
      [provider] = body.model.split(',');
    }
  }

  // Estimate token count for smart key selection
  const estimatedTokens = estimateTokenCount(body);

  // Select key from pool
  const selectedKey = apiKeyPool.getKey(provider, estimatedTokens);

  if (!selectedKey) {
    console.warn(`[API-KEY-POOL-MIDDLEWARE] No available keys for provider ${provider}`);
    // Let request proceed with default key (will be handled by existing auth)
    return;
  }

  // Store context for later use
  (req as any).__apiKeyPoolContext = {
    selectedKey,
    estimatedTokens,
    startTime,
  } as ApiKeyPoolContext;

  console.log(`[API-KEY-POOL-MIDDLEWARE] Using key ${selectedKey.metrics.key} for ${provider}`);
};

/**
 * Response hook to record key usage metrics
 */
export const apiKeyPoolResponseMiddleware = async (req: FastifyRequest, reply: FastifyReply) => {
  const context = (req as any).__apiKeyPoolContext as ApiKeyPoolContext;
  if (!context || !context.selectedKey) {
    return;
  }

  const latency = Date.now() - context.startTime;
  const success = reply.statusCode < 400;
  const statusCode = reply.statusCode;

  // Get actual token count from response if available
  let actualTokens = context.estimatedTokens;
  const responseData = (reply as any)._responseData || (req as any).__responseData;
  if (responseData?.usage) {
    actualTokens = (responseData.usage.input_tokens || 0) + (responseData.usage.output_tokens || 0);
  }

  // Record usage
  apiKeyPool.recordUsage(
    context.selectedKey.keyHash,
    actualTokens,
    latency,
    success
  );

  // Handle rate limiting
  if (statusCode === 429) {
    // Extract reset time from headers if available
    const resetTime = extractRateLimitReset(reply);
    apiKeyPool.markRateLimited(context.selectedKey.keyHash, resetTime);
  }

  // Handle auth errors (invalid key)
  if (statusCode === 401 || statusCode === 403) {
    apiKeyPool.markUnavailable(context.selectedKey.keyHash, `Auth error: ${statusCode}`);
  }

  console.log(`[API-KEY-POOL-MIDDLEWARE] Recorded usage for key ${context.selectedKey.metrics.key}: ${actualTokens} tokens, ${latency}ms, success: ${success}`);
};

/**
 * Estimate token count from request body
 */
function estimateTokenCount(body: any): number {
  if (!body) return 0;

  let textLength = 0;

  // Count message content
  if (body.messages && Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (typeof message.content === 'string') {
        textLength += message.content.length;
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            textLength += block.text.length;
          }
        }
      }
    }
  }

  // Count system prompt
  if (body.system) {
    if (typeof body.system === 'string') {
      textLength += body.system.length;
    } else if (Array.isArray(body.system)) {
      for (const block of body.system) {
        if (block.type === 'text' && block.text) {
          textLength += block.text.length;
        }
      }
    }
  }

  // Add max_tokens for response
  const maxTokens = body.max_tokens || 1024;

  // Rough estimation: 4 characters per token for input, plus max_tokens for output
  return Math.ceil(textLength / 4) + maxTokens;
}

/**
 * Extract rate limit reset time from response headers
 */
function extractRateLimitReset(reply: FastifyReply): number | undefined {
  const headers = reply.getHeaders();
  
  // Check various rate limit header formats
  const rateLimitReset = headers['x-ratelimit-reset'] || 
                         headers['ratelimit-reset'] ||
                         headers['retry-after'];

  if (rateLimitReset) {
    if (typeof rateLimitReset === 'string') {
      const parsed = parseInt(rateLimitReset, 10);
      if (!isNaN(parsed)) {
        // If it's a Unix timestamp
        if (parsed > 1000000000000) {
          return parsed;
        }
        // If it's seconds from now
        return Date.now() + (parsed * 1000);
      }
    } else if (typeof rateLimitReset === 'number') {
      return Date.now() + (rateLimitReset * 1000);
    }
  }

  return undefined;
}

/**
 * Get the selected API key for the current request
 * Can be used to override provider API key in the proxy layer
 */
export function getSelectedApiKey(req: FastifyRequest): string | null {
  const context = (req as any).__apiKeyPoolContext as ApiKeyPoolContext;
  return context?.selectedKey?.key || null;
}
