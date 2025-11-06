import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable, Transform, Writable } from 'stream';
import * as zlib from 'zlib';
import { getCompressionConfig, CompressionConfig } from '../config/compression.config';

export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  encoding: string;
  duration: number;
}

export interface CompressionResult {
  data: Buffer | string;
  encoding: string;
  stats: CompressionStats;
}

export class CompressionManager {
  private config: CompressionConfig;
  private compressionCache: Map<string, CompressionResult>;

  constructor(config: CompressionConfig) {
    this.config = config;
    this.compressionCache = new Map();
  }

  private isCompressible(contentType?: string): boolean {
    if (!contentType) {
      return false;
    }

    const normalizedType = contentType.toLowerCase().split(';')[0];

    // Check if type is explicitly compressible
    if (this.config.compressibleTypes.some(type => {
      if (type.includes('*')) {
        const regex = new RegExp(type.replace('*', '.*'));
        return regex.test(normalizedType);
      }
      return type === normalizedType;
    })) {
      return true;
    }

    // Check if type is explicitly excluded
    if (this.config.excludeTypes.some(type => {
      if (type.includes('*')) {
        const regex = new RegExp(type.replace('*', '.*'));
        return regex.test(normalizedType);
      }
      return type === normalizedType;
    })) {
      return false;
    }

    // Default to compressing text types
    return normalizedType.startsWith('text/') ||
           normalizedType.includes('json') ||
           normalizedType.includes('xml') ||
           normalizedType.includes('javascript');
  }

  private shouldCompress(data: Buffer | string, contentType?: string): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const size = Buffer.byteLength(data.toString());

    // Check minimum size threshold
    if (size < this.config.threshold) {
      return false;
    }

    // Check if content type is compressible
    return this.isCompressible(contentType);
  }

  private createCompressor(encoding: string): zlib.Transform {
    const options: zlib.ZlibOptions = {
      level: this.config.level
    };

    switch (encoding) {
      case 'gzip':
        return zlib.createGzip(options);
      case 'deflate':
        return zlib.createDeflate(options);
      case 'br':
        return zlib.createBrotliCompress(options);
      default:
        throw new Error(`Unsupported compression encoding: ${encoding}`);
    }
  }

  private createDecompressor(encoding: string): zlib.Transform {
    switch (encoding) {
      case 'gzip':
        return zlib.createGunzip();
      case 'deflate':
        return zlib.createInflate();
      case 'br':
        return zlib.createBrotliDecompress();
      default:
        throw new Error(`Unsupported decompression encoding: ${encoding}`);
    }
  }

  private selectEncoding(acceptEncoding?: string): string {
    if (!acceptEncoding) {
      return 'identity';
    }

    const encodings = acceptEncoding
      .split(',')
      .map(e => e.trim().split(';')[0])
      .filter(e => this.config.encodings.includes(e));

    // Prefer Brotli over gzip over deflate
    if (encodings.includes('br')) return 'br';
    if (encodings.includes('gzip')) return 'gzip';
    if (encodings.includes('deflate')) return 'deflate';

    return 'identity';
  }

  async compress(
    data: Buffer | string,
    contentType?: string,
    acceptEncoding?: string
  ): Promise<CompressionResult> {
    const startTime = Date.now();
    const encoding = this.selectEncoding(acceptEncoding);

    // Check if compression should be applied
    if (encoding === 'identity' || !this.shouldCompress(data, contentType)) {
      const originalSize = Buffer.byteLength(data.toString());
      return {
        data,
        encoding: 'identity',
        stats: {
          originalSize,
          compressedSize: originalSize,
          compressionRatio: 1,
          encoding: 'identity',
          duration: Date.now() - startTime
        }
      };
    }

    const originalSize = Buffer.byteLength(data.toString());
    const inputBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    try {
      // Create compressor
      const compressor = this.createCompressor(encoding);

      // Compress the data
      const compressedBuffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        compressor.on('data', (chunk) => chunks.push(chunk));
        compressor.on('end', () => resolve(Buffer.concat(chunks)));
        compressor.on('error', reject);
        compressor.end(inputBuffer);
      });

      const compressedSize = compressedBuffer.length;
      const duration = Date.now() - startTime;

      const result: CompressionResult = {
        data: compressedBuffer,
        encoding,
        stats: {
          originalSize,
          compressedSize,
          compressionRatio: originalSize > 0 ? compressedSize / originalSize : 1,
          encoding,
          duration
        }
      };

      // Cache the result if enabled
      if (this.compressionCache.size < this.config.cacheSize) {
        const cacheKey = this.generateCacheKey(data.toString(), encoding);
        this.compressionCache.set(cacheKey, result);
      }

      return result;

    } catch (error) {
      console.error('[COMPRESSION] Failed to compress data:', error);

      // Return uncompressed data on error
      return {
        data,
        encoding: 'identity',
        stats: {
          originalSize,
          compressedSize: originalSize,
          compressionRatio: 1,
          encoding: 'identity',
          duration: Date.now() - startTime
        }
      };
    }
  }

  async decompress(
    data: Buffer,
    encoding: string
  ): Promise<Buffer> {
    if (encoding === 'identity' || encoding === 'none') {
      return data;
    }

    try {
      const decompressor = this.createDecompressor(encoding);

      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        decompressor.on('data', (chunk) => chunks.push(chunk));
        decompressor.on('end', () => resolve(Buffer.concat(chunks)));
        decompressor.on('error', reject);
        decompressor.end(data);
      });

    } catch (error) {
      console.error('[COMPRESSION] Failed to decompress data:', error);
      throw new Error(`Decompression failed for encoding ${encoding}: ${error}`);
    }
  }

  createCompressStream(
    acceptEncoding?: string,
    contentType?: string
  ): Transform {
    const encoding = this.selectEncoding(acceptEncoding);

    // If no compression should be applied, return passthrough stream
    if (encoding === 'identity' || !this.isCompressible(contentType)) {
      return new Transform({
        transform(chunk, encoding, callback) {
          callback(null, chunk);
        }
      });
    }

    const compressor = this.createCompressor(encoding);
    let originalSize = 0;
    let compressedSize = 0;

    // Wrap compressor to track statistics
    const trackingStream = new Transform({
      transform(chunk, encoding, callback) {
        originalSize += chunk.length;
        compressor.write(chunk, encoding, () => {
          // Wait for compressor to process
        });
        callback();
      },
      flush(callback) {
        compressor.end();
        compressor.on('data', (chunk) => {
          compressedSize += chunk.length;
          this.push(chunk);
        });
        compressor.on('end', () => {
          console.log(`[COMPRESSION] Stream compression - Original: ${originalSize}, Compressed: ${compressedSize}, Ratio: ${(compressedSize / originalSize).toFixed(2)}`);
          callback();
        });
      }
    });

    return trackingStream;
  }

  createDecompressStream(encoding: string): Transform {
    if (encoding === 'identity' || encoding === 'none') {
      return new Transform({
        transform(chunk, encoding, callback) {
          callback(null, chunk);
        }
      });
    }

    const decompressor = this.createDecompressor(encoding);
    return decompressor;
  }

  private generateCacheKey(data: string, encoding: string): string {
    // Simple cache key based on hash and encoding
    // In production, you might want to use a better hashing function
    const hash = require('crypto')
      .createHash('md5')
      .update(data)
      .digest('hex');
    return `${hash}:${encoding}`;
  }

  getStats(): {
    enabled: boolean;
    config: CompressionConfig;
    cacheSize: number;
  } {
    return {
      enabled: this.config.enabled,
      config: this.config,
      cacheSize: this.compressionCache.size
    };
  }

  clearCache(): void {
    this.compressionCache.clear();
  }

  updateConfig(newConfig: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    // Clear cache when config changes
    this.clearCache();
  }

  getConfig(): CompressionConfig {
    return { ...this.config };
  }
}

// Global compression manager instance
let globalCompressionManager: CompressionManager | null = null;

export function getCompressionManager(config?: CompressionConfig): CompressionManager {
  if (!globalCompressionManager) {
    if (!config) {
      throw new Error('Compression config required for first initialization');
    }
    globalCompressionManager = new CompressionManager(config);
  }
  return globalCompressionManager;
}

export function createCompressionManager(config: CompressionConfig): CompressionManager {
  return new CompressionManager(config);
}

// Utility function to compress cached responses
export async function compressCachedResponse(
  response: any,
  acceptEncoding?: string
): Promise<CompressionResult | null> {
  try {
    const contentType = response.headers?.['content-type'] || 'application/json';
    const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

    const compressionManager = getCompressionManager();
    const result = await compressionManager.compress(data, contentType, acceptEncoding);

    // Update response headers
    if (result.encoding !== 'identity') {
      response.headers = {
        ...response.headers,
        'content-encoding': result.encoding,
        'content-length': Buffer.byteLength(result.data.toString()),
        'x-compression-stats': JSON.stringify({
          originalSize: result.stats.originalSize,
          compressedSize: result.stats.compressedSize,
          ratio: result.stats.compressionRatio.toFixed(2)
        })
      };
    }

    response.data = result.data;
    return result;

  } catch (error) {
    console.error('[COMPRESSION] Failed to compress cached response:', error);
    return null;
  }
}

// Middleware helper function
export function shouldCompressResponse(
  statusCode: number,
  contentType?: string,
  size?: number
): boolean {
  // Don't compress certain status codes
  const noCompressCodes = [100, 101, 102, 204, 304];
  if (noCompressCodes.includes(statusCode)) {
    return false;
  }

  // Don't compress if already compressed
  if (contentType?.includes('gzip') || contentType?.includes('deflate') || contentType?.includes('br')) {
    return false;
  }

  // Don't compress if below threshold
  if (size && size < 1024) { // 1KB default threshold
    return false;
  }

  return true;
}