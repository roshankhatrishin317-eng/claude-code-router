/**
 * Cache Middleware for Fastify
 * 
 * Intercepts requests and responses to implement caching logic
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { getCache } from '../utils/requestCache';

/**
 * Cache middleware - checks if response is cached before processing
 */
export const cacheMiddleware = async (req: FastifyRequest, reply: FastifyReply) => {
  // Only cache specific endpoints
  if (!shouldCache(req)) {
    return;
  }

  const cache = getCache();
  if (!cache) {
    return;
  }

  try {
    // Try to get cached response
    const cachedResponse = await cache.get(req.body);

    if (cachedResponse) {
      // Return cached response immediately
      reply.header('X-Cache', 'HIT');
      reply.header('X-Cache-Key', cache.generateCacheKey(req.body).substring(0, 16));
      reply.send(cachedResponse);
      
      // Mark request as handled by cache
      (req as any).__cachedResponse = true;
    } else {
      reply.header('X-Cache', 'MISS');
    }
  } catch (error) {
    console.error('[CACHE-MIDDLEWARE] Error checking cache:', error);
    // Continue without cache on error
  }
};

/**
 * Cache response middleware - stores successful responses
 */
export const cacheResponseMiddleware = async (req: FastifyRequest, reply: FastifyReply) => {
  // Skip if already cached or shouldn't cache
  if ((req as any).__cachedResponse || !shouldCache(req)) {
    return;
  }

  const cache = getCache();
  if (!cache) {
    return;
  }

  try {
    // Only cache successful responses
    if (reply.statusCode >= 200 && reply.statusCode < 300) {
      // Get response data
      const responseData = (reply as any).__responseData || (req as any).__responseData;
      
      if (responseData && req.body) {
        // Extract metadata for cache entry
        let provider = 'unknown';
        let model = 'unknown';
        const body = req.body as any;

        if (body?.model) {
          if (typeof body.model === 'string' && body.model.includes(',')) {
            [provider, model] = body.model.split(',');
          } else {
            model = body.model;
          }
        }

        const metadata = {
          provider,
          model,
          sessionId: (req as any).sessionId,
          tokens: responseData.usage ? {
            input: responseData.usage.input_tokens || responseData.usage.prompt_tokens || 0,
            output: responseData.usage.output_tokens || responseData.usage.completion_tokens || 0,
          } : undefined,
          timestamp: Date.now(),
        };

        // Store in cache
        await cache.set(req.body, responseData, metadata);
      }
    }
  } catch (error) {
    console.error('[CACHE-RESPONSE-MIDDLEWARE] Error storing cache:', error);
    // Don't let cache errors break the request
  }
};

/**
 * Determine if request should be cached
 */
function shouldCache(req: FastifyRequest): boolean {
  // Only cache POST requests to messages endpoint
  if (req.method !== 'POST') {
    return false;
  }

  if (!req.url.startsWith('/v1/messages')) {
    return false;
  }

  // Don't cache token counting endpoint
  if (req.url.includes('/count_tokens')) {
    return false;
  }

  const body = req.body as any;
  
  // Don't cache streaming requests
  if (body?.stream === true) {
    return false;
  }

  // Don't cache if temperature is too high (more random)
  if (body?.temperature && body.temperature > 0.7) {
    return false;
  }

  // Don't cache if explicitly disabled
  if (body?.cache === false || body?.metadata?.cache === false) {
    return false;
  }

  return true;
}

/**
 * Helper to extract response data for caching
 * This intercepts the response before it's sent
 */
export function interceptResponse(reply: FastifyReply, data: any): void {
  try {
    // Store response data for cache middleware
    if (typeof data === 'string') {
      try {
        (reply as any).__responseData = JSON.parse(data);
      } catch {
        // Not JSON, skip caching
      }
    } else if (data && typeof data === 'object') {
      (reply as any).__responseData = data;
    }
  } catch (error) {
    // Ignore errors in response interception
  }
}
