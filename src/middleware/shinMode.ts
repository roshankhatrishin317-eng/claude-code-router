/**
 * Shin Mode Middleware
 * 
 * Integrates Shin Mode sequential processing with request handling
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { shinModeManager, RequestPriority } from '../utils/shinMode';

export interface ShinModeContext {
  queued: boolean;
  startTime: number;
  provider: string;
  priority: RequestPriority;
}

/**
 * Middleware to queue requests in Shin Mode
 */
export const shinModeMiddleware = async (req: FastifyRequest, reply: FastifyReply) => {
  // Only process API requests
  if (!req.url.startsWith('/v1/messages') || req.method !== 'POST') {
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

  // Check if Shin Mode is enabled for this provider
  if (!shinModeManager.isEnabled(provider)) {
    return; // Continue with normal processing
  }

  // Determine priority (can be customized based on request metadata)
  let priority: RequestPriority = 'normal';
  if (body.metadata?.priority) {
    priority = body.metadata.priority as RequestPriority;
  }

  // Store context
  (req as any).__shinModeContext = {
    queued: true,
    startTime,
    provider,
    priority,
  } as ShinModeContext;

  console.log(`[SHIN-MODE-MIDDLEWARE] Request queued for ${provider} with priority ${priority}`);

  try {
    // Queue the request (this will block until it's this request's turn)
    const result = await shinModeManager.processRequest(provider, req, reply, priority);

    if (result === null) {
      // Shin Mode not enabled, continue normally
      return;
    }

    // Request is now at the front of the queue, can proceed
    console.log(`[SHIN-MODE-MIDDLEWARE] Request processing for ${provider}`);
    
  } catch (error) {
    console.error('[SHIN-MODE-MIDDLEWARE] Error in Shin Mode processing:', error);
    reply.status(503).send({
      error: {
        type: 'shin_mode_error',
        message: (error as Error).message,
      },
    });
  }
};

/**
 * Response middleware to track Shin Mode request completion
 */
export const shinModeResponseMiddleware = async (req: FastifyRequest, reply: FastifyReply) => {
  const context = (req as any).__shinModeContext as ShinModeContext;
  if (!context || !context.queued) {
    return;
  }

  const duration = Date.now() - context.startTime;
  const success = reply.statusCode < 400;

  console.log(`[SHIN-MODE-MIDDLEWARE] Request completed for ${context.provider}, duration: ${duration}ms, success: ${success}`);
};

/**
 * Extract priority from request
 */
export function extractPriority(req: FastifyRequest): RequestPriority {
  const body = req.body as any;
  
  // Check metadata
  if (body?.metadata?.priority) {
    const priority = body.metadata.priority.toLowerCase();
    if (['critical', 'high', 'normal', 'low'].includes(priority)) {
      return priority as RequestPriority;
    }
  }

  // Check headers
  const priorityHeader = req.headers['x-priority'] as string;
  if (priorityHeader) {
    const priority = priorityHeader.toLowerCase();
    if (['critical', 'high', 'normal', 'low'].includes(priority)) {
      return priority as RequestPriority;
    }
  }

  // Default
  return 'normal';
}
