export interface CompressionConfig {
  enabled: boolean;
  threshold: number;
  level: number;
  encodings: string[];
  compressibleTypes: string[];
  excludeTypes: string[];
  streaming: boolean;
  cacheSize: number;
  chunkSize: number;
}

const getCompressionConfigFromEnv = (): Partial<CompressionConfig> => {
  const config: Partial<CompressionConfig> = {};

  if (process.env.COMPRESSION_ENABLED !== undefined) {
    config.enabled = process.env.COMPRESSION_ENABLED === 'true';
  }
  if (process.env.COMPRESSION_THRESHOLD) {
    config.threshold = parseInt(process.env.COMPRESSION_THRESHOLD);
  }
  if (process.env.COMPRESSION_LEVEL) {
    config.level = parseInt(process.env.COMPRESSION_LEVEL);
  }
  if (process.env.COMPRESSION_ENCODINGS) {
    config.encodings = process.env.COMPRESSION_ENCODINGS.split(',');
  }
  if (process.env.COMPRESSION_COMPRESSIBLE_TYPES) {
    config.compressibleTypes = process.env.COMPRESSION_COMPRESSIBLE_TYPES.split(',');
  }
  if (process.env.COMPRESSION_EXCLUDE_TYPES) {
    config.excludeTypes = process.env.COMPRESSION_EXCLUDE_TYPES.split(',');
  }
  if (process.env.COMPRESSION_STREAMING !== undefined) {
    config.streaming = process.env.COMPRESSION_STREAMING === 'true';
  }
  if (process.env.COMPRESSION_CACHE_SIZE) {
    config.cacheSize = parseInt(process.env.COMPRESSION_CACHE_SIZE);
  }
  if (process.env.COMPRESSION_CHUNK_SIZE) {
    config.chunkSize = parseInt(process.env.COMPRESSION_CHUNK_SIZE);
  }

  return config;
};

export const getCompressionConfig = (config: any): CompressionConfig => {
  const envConfig = getCompressionConfigFromEnv();

  const defaultConfig: CompressionConfig = {
    enabled: true,
    threshold: 1024, // 1KB
    level: 6, // Default compression level (1-9)
    encodings: ['gzip', 'br', 'deflate'],
    compressibleTypes: [
      'application/json',
      'application/javascript',
      'application/xml',
      'text/css',
      'text/html',
      'text/javascript',
      'text/plain',
      'text/xml',
      'text/markdown'
    ],
    excludeTypes: [
      'image/*',
      'video/*',
      'audio/*',
      'application/octet-stream',
      'application/zip',
      'application/gzip'
    ],
    streaming: true,
    cacheSize: 1000,
    chunkSize: 4096
  };

  const mergedConfig = {
    ...defaultConfig,
    ...envConfig,
    ...config.Compression,
  };

  return mergedConfig;
};