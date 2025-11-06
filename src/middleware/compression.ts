import { FastifyRequest, FastifyReply } from 'fastify';
import { getCompressionManager, shouldCompressResponse } from '../utils/compression';
import { getCompressionConfig } from '../config/compression.config';
import { getLogger } from '../utils/logger';

const logger = getLogger();
const config = getCompressionConfig({});
const compressionManager = getCompressionManager(config);

// Compression middleware
export async function compressionMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Skip compression if not enabled
    if (!config.enabled) {
      return;
    }

    // Get accept encoding header
    const acceptEncoding = request.headers['accept-encoding'];
    const contentType = reply.getHeader('content-type') as string;

    // Check if response should be compressed
    const contentLength = reply.getHeader('content-length') as number;
    if (!shouldCompressResponse(reply.statusCode, contentType, contentLength)) {
      return;
    }

    // Set up compression
    const encoding = compressionManager.selectEncoding(acceptEncoding);

    if (encoding !== 'identity') {
      // Create compress stream
      const compressStream = compressionManager.createCompressStream(acceptEncoding, contentType);

      // Override response headers
      reply.header('content-encoding', encoding);
      reply.removeHeader('content-length'); // Will be set after compression

      // Store original res.write and res.end
      const originalWrite = reply.raw.write;
      const originalEnd = reply.raw.end;

      // Transform response through compression
      reply.raw.write = function(chunk: any, encoding?: any, cb?: any) {
        if (chunk) {
          compressStream.write(chunk, encoding);
        }
        if (cb) cb();
        return true;
      };

      reply.raw.end = function(chunk?: any, encoding?: any, cb?: any) {
        if (chunk) {
          compressStream.write(chunk, encoding);
        }
        compressStream.end();

        compressStream.on('data', (compressedChunk) => {
          originalWrite.call(reply.raw, compressedChunk);
        });

        compressStream.on('end', () => {
          originalEnd.call(reply.raw, null, null, cb);
        });
      };

      // Log compression
      logger.debug('Response compression enabled', {
        encoding,
        contentType,
        url: request.url,
        method: request.method
      });
    }

  } catch (error) {
    logger.error('Compression middleware error', error as Error, {
      url: request.url,
      method: request.method
    });
  }
}

// Response compression interceptor
export async function responseCompressionInterceptor(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: any
): Promise<any> {
  try {
    // Skip compression if not enabled or no payload
    if (!config.enabled || !payload) {
      return payload;
    }

    // Skip for certain content types and status codes
    const contentType = reply.getHeader('content-type') as string;
    const contentLength = payload ? Buffer.byteLength(typeof payload === 'string' ? payload : JSON.stringify(payload)) : 0;

    if (!shouldCompressResponse(reply.statusCode, contentType, contentLength)) {
      return payload;
    }

    // Get accept encoding header
    const acceptEncoding = request.headers['accept-encoding'];

    // Compress the payload
    const result = await compressionManager.compress(
      payload,
      contentType,
      acceptEncoding
    );

    // Update response headers if compression was applied
    if (result.encoding !== 'identity') {
      reply.header('content-encoding', result.encoding);
      reply.header('content-length', Buffer.byteLength(result.data.toString()));

      // Add compression stats header for debugging
      reply.header('x-compression-stats', JSON.stringify({
        originalSize: result.stats.originalSize,
        compressedSize: result.stats.compressedSize,
        ratio: result.stats.compressionRatio.toFixed(2),
        duration: result.stats.duration
      }));

      // Log successful compression
      logger.debug('Response compressed', {
        encoding: result.encoding,
        originalSize: result.stats.originalSize,
        compressedSize: result.stats.compressedSize,
        ratio: result.stats.compressionRatio.toFixed(2),
        url: request.url,
        method: request.method
      });
    }

    return result.data;

  } catch (error) {
    logger.error('Response compression interceptor error', error as Error, {
      url: request.url,
      method: request.method,
      statusCode: reply.statusCode
    });

    // Return original payload on error
    return payload;
  }
}

// Cache compression utility
export async function compressCachedData(
  data: any,
  contentType: string = 'application/json',
  acceptEncoding?: string
): Promise<{ data: any; headers: Record<string, string> }> {
  try {
    const result = await compressionManager.compress(
      data,
      contentType,
      acceptEncoding
    );

    const headers: Record<string, string> = {};

    if (result.encoding !== 'identity') {
      headers['content-encoding'] = result.encoding;
      headers['content-length'] = Buffer.byteLength(result.data.toString());
      headers['x-compression-stats'] = JSON.stringify({
        originalSize: result.stats.originalSize,
        compressedSize: result.stats.compressedSize,
        ratio: result.stats.compressionRatio.toFixed(2),
        duration: result.stats.duration
      });

      logger.debug('Cached data compressed', {
        encoding: result.encoding,
        originalSize: result.stats.originalSize,
        compressedSize: result.stats.compressedSize,
        ratio: result.stats.compressionRatio.toFixed(2)
      });
    }

    return {
      data: result.data,
      headers
    };

  } catch (error) {
    logger.error('Failed to compress cached data', error as Error);
    return {
      data,
      headers: {}
    };
  }
}

// Streaming compression helper
export function createStreamingCompressor(
  acceptEncoding?: string,
  contentType?: string
): {
  stream: NodeJS.ReadWriteStream;
  getStats: () => { originalSize: number; compressedSize: number };
} {
  let originalSize = 0;
  let compressedSize = 0;

  const compressor = compressionManager.createCompressStream(acceptEncoding, contentType);

  // Track sizes
  const trackingStream = compressor as any;
  trackingStream.on('data', (chunk: Buffer) => {
    compressedSize += chunk.length;
  });

  const enhancedCompressor = new Transform({
    transform(chunk: Buffer, encoding, callback) {
      originalSize += chunk.length;
      trackingStream.write(chunk, encoding);
      callback();
    },
    flush(callback) {
      trackingStream.end();
      callback();
    }
  });

  return {
    stream: enhancedCompressor,
    getStats: () => ({
      originalSize,
      compressedSize
    })
  };
}

// Decompression helper for request bodies
export async function decompressRequestBody(
  request: FastifyRequest
): Promise<any> {
  try {
    const contentEncoding = request.headers['content-encoding'];

    if (!contentEncoding || contentEncoding === 'identity') {
      return request.body;
    }

    // Handle pre-parsed body (string/buffer)
    let bodyBuffer: Buffer;
    if (Buffer.isBuffer(request.body)) {
      bodyBuffer = request.body;
    } else if (typeof request.body === 'string') {
      bodyBuffer = Buffer.from(request.body);
    } else {
      // For objects, need to get raw body (this is complex in Fastify)
      logger.warn('Cannot decompress object request body', {
        contentType: request.headers['content-type'],
        encoding: contentEncoding
      });
      return request.body;
    }

    const decompressed = await compressionManager.decompress(bodyBuffer, contentEncoding);

    // Parse back to object based on content type
    const contentType = (request.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('json')) {
      return JSON.parse(decompressed.toString());
    } else {
      return decompressed.toString();
    }

  } catch (error) {
    logger.error('Failed to decompress request body', error as Error, {
      contentType: request.headers['content-type'],
      encoding: request.headers['content-encoding']
    });

    // Return original body on error
    return request.body;
  }
}

// Compression statistics endpoint helper
export function getCompressionStats() {
  const stats = compressionManager.getStats();
  return {
    enabled: stats.enabled,
    config: stats.config,
    cacheSize: stats.cacheSize,
    supportedEncodings: ['gzip', 'br', 'deflate']
  };
}

export default {
  compressionMiddleware,
  responseCompressionInterceptor,
  compressCachedData,
  createStreamingCompressor,
  decompressRequestBody,
  getCompressionStats
};