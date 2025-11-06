import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getLogger, Logger } from '../utils/logger';
import { getLoggingConfig } from '../config/logging.config';

const config = getLoggingConfig({});
const logger = getLogger();

// Generate correlation ID
function generateCorrelationId(): string {
  return uuidv4();
}

// Extract correlation ID from request headers
function extractCorrelationId(request: FastifyRequest): string | undefined {
  const headers = request.headers as any;
  return headers['x-correlation-id'] || headers['x-request-id'];
}

// Add correlation ID to request object
function addCorrelationId(request: FastifyRequest, reply: FastifyReply): string {
  let correlationId = extractCorrelationId(request);

  if (!correlationId) {
    correlationId = generateCorrelationId();
  }

  // Add to request for later use
  (request as any).correlationId = correlationId;
  (request as any).startTime = Date.now();

  // Add to response headers
  reply.header('x-correlation-id', correlationId);

  return correlationId;
}

// Create child logger with request context
function createRequestLogger(request: FastifyRequest): Logger {
  const correlationId = (request as any).correlationId;
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const context = {
    correlationId,
    requestId,
    method: request.method,
    url: request.url,
    userAgent: request.headers['user-agent'],
    ip: request.ip || request.headers['x-forwarded-for'],
    contentType: request.headers['content-type']
  };

  return logger.child(context);
}

// Log incoming requests
export async function requestLoggingMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    // Add correlation ID
    const correlationId = addCorrelationId(request, reply);

    // Create request-specific logger
    const requestLogger = createRequestLogger(request);
    (request as any).requestLogger = requestLogger;

    // Log the request
    requestLogger.logRequest(request, {
      body: request.method === 'POST' ? sanitizeRequestBody(request.body) : undefined
    });

  } catch (error) {
    logger.error('Request logging middleware error', error as Error);
  }
}

// Log outgoing responses
export async function responseLoggingMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const requestLogger: Logger = (request as any).requestLogger || logger;
    const startTime = (request as any).startTime || Date.now();
    const duration = Date.now() - startTime;

    // Additional response data
    const responseData = {
      statusCode: reply.statusCode,
      duration,
      contentLength: reply.getHeader('content-length'),
      contentType: reply.getHeader('content-type'),
      cacheControl: reply.getHeader('cache-control')
    };

    requestLogger.logResponse(request, reply, responseData);

    // Log slow requests
    if (duration > 5000) { // 5 seconds threshold
      requestLogger.warn('Slow request detected', {
        duration,
        threshold: 5000,
        body: request.method === 'POST' ? sanitizeRequestBody(request.body) : undefined
      });
    }

  } catch (error) {
    logger.error('Response logging middleware error', error as Error);
  }
}

// Sanitize request body for logging (remove sensitive data)
function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sensitiveFields = [
    'password', 'token', 'secret', 'key', 'apiKey',
    'authorization', 'auth', 'credential', 'private'
  ];

  const sanitized = { ...body };

  function sanitizeObject(obj: any): void {
    if (!obj || typeof obj !== 'object') return;

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const lowerKey = key.toLowerCase();

        // Check if field name contains sensitive keywords
        const isSensitive = sensitiveFields.some(field =>
          lowerKey.includes(field.toLowerCase())
        );

        if (isSensitive) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          sanitizeObject(obj[key]);
        }
      }
    }
  }

  sanitizeObject(sanitized);
  return sanitized;
}

// Error logging middleware
export async function errorLoggingMiddleware(
  error: Error,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const requestLogger: Logger = (request as any).requestLogger || logger;
    const startTime = (request as any).startTime || Date.now();
    const duration = Date.now() - startTime;

    // Enhanced error logging
    requestLogger.error('Request failed', error, {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration,
      body: request.method === 'POST' ? sanitizeRequestBody(request.body) : undefined,
      stack: error.stack,
      name: error.name
    });

    // Log security-related errors differently
    const securityErrorPatterns = [
      /unauthorized/i,
      /forbidden/i,
      /authentication/i,
      /token/i,
      /csrf/i
    ];

    const isSecurityError = securityErrorPatterns.some(pattern =>
      pattern.test(error.message) || pattern.test(error.name)
    );

    if (isSecurityError) {
      requestLogger.logSecurityEvent('authentication_error', {
        message: error.message,
        url: request.url,
        userAgent: request.headers['user-agent'],
        ip: request.ip || request.headers['x-forwarded-for']
      });
    }

  } catch (logError) {
    // Fallback to basic logging if middleware fails
    logger.error('Error logging middleware failed', logError as Error);
    logger.error('Original error', error);
  }
}

// Performance monitoring middleware
export async function performanceLoggingMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const startTime = Date.now();
  (request as any).performanceStart = startTime;

  // Hook into response to log performance metrics
  reply.raw.on('finish', () => {
    try {
      const duration = Date.now() - startTime;
      const requestLogger: Logger = (request as any).requestLogger || logger;

      // Log performance data
      requestLogger.logPerformance('http_request', duration, {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        contentLength: reply.getHeader('content-length')
      });

      // Log performance warnings
      if (duration > 10000) { // 10 seconds
        requestLogger.warn('Very slow request', {
          duration,
          method: request.method,
          url: request.url
        });
      }

    } catch (error) {
      logger.error('Performance logging error', error as Error);
    }
  });
}

// HTTP access log middleware (similar to nginx access logs)
export async function accessLogMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const startTime = (request as any).startTime || Date.now();
    const duration = Date.now() - startTime;

    const logData = {
      timestamp: new Date().toISOString(),
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration,
      contentLength: reply.getHeader('content-length'),
      userAgent: request.headers['user-agent'],
      ip: request.ip || request.headers['x-forwarded-for'],
      referer: request.headers['referer'],
      correlationId: (request as any).correlationId
    };

    // Use info level for successful requests, warn for errors
    const logLevel = reply.statusCode >= 400 ? 'warn' : 'info';
    logger[logLevel]('HTTP access', logData);

  } catch (error) {
    logger.error('Access log middleware error', error as Error);
  }
}

// Rate limiting logging middleware
export async function rateLimitLoggingMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  rateLimitInfo: any
): Promise<void> {
  try {
    const requestLogger: Logger = (request as any).requestLogger || logger;

    requestLogger.logSecurityEvent('rate_limit_exceeded', {
      limit: rateLimitInfo.limit,
      current: rateLimitInfo.current,
      remaining: rateLimitInfo.remaining,
      resetTime: rateLimitInfo.resetTime,
      method: request.method,
      url: request.url,
      ip: request.ip || request.headers['x-forwarded-for'],
      userAgent: request.headers['user-agent']
    });

  } catch (error) {
    logger.error('Rate limit logging error', error as Error);
  }
}

// Circuit breaker logging middleware
export function createCircuitBreakerLogger(provider: string, model?: string): Logger {
  return logger.child({
    provider,
    model,
    component: 'circuit-breaker'
  });
}

// Cache logging middleware
export function createCacheLogger(): Logger {
  return logger.child({
    component: 'cache'
  });
}

// Provider logging utility
export function createProviderLogger(provider: string): Logger {
  return logger.child({
    provider,
    component: 'provider'
  });
}

// Connection pool logging utility
export function createConnectionLogger(): Logger {
  return logger.child({
    component: 'connection-pool'
  });
}

// Metrics logging utility
export function createMetricsLogger(): Logger {
  return logger.child({
    component: 'metrics'
  });
}

// Health check logging utility
export function createHealthLogger(): Logger {
  return logger.child({
    component: 'health-check'
  });
}

export default {
  requestLoggingMiddleware,
  responseLoggingMiddleware,
  errorLoggingMiddleware,
  performanceLoggingMiddleware,
  accessLogMiddleware,
  rateLimitLoggingMiddleware,
  createCircuitBreakerLogger,
  createCacheLogger,
  createProviderLogger,
  createConnectionLogger,
  createMetricsLogger,
  createHealthLogger
};