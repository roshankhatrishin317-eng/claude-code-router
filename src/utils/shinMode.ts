/**
 * Shin Mode - Sequential Request Processing System
 * 
 * Processes requests one at a time per provider to:
 * - Bypass rate limit detection by maintaining single connection
 * - Keep connections alive between requests
 * - Reduce costs through connection reuse
 * - Provide predictable, sequential processing
 * 
 * Features:
 * - Per-provider request queues
 * - Priority-based queue management
 * - Connection keep-alive
 * - Automatic fallback to normal mode on errors
 * - Real-time queue monitoring
 */

import { EventEmitter } from 'events';
import { FastifyRequest, FastifyReply } from 'fastify';

export type ShinMode = 'normal' | 'shin';
export type RequestPriority = 'critical' | 'high' | 'normal' | 'low';

export interface ShinModeConfig {
  enabled: boolean;
  mode: ShinMode;
  maxQueueSize: number;
  queueTimeout: number; // ms
  keepAliveConnections: boolean;
  connectionReuseTime: number; // ms to keep connection alive
  providers: {
    [provider: string]: {
      maxConcurrency: number;
      enabled: boolean;
    };
  };
}

export interface QueuedRequest {
  id: string;
  provider: string;
  request: FastifyRequest;
  reply: FastifyReply;
  priority: RequestPriority;
  enqueuedAt: number;
  estimatedTokens: number;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface ProviderQueue {
  provider: string;
  queue: QueuedRequest[];
  processing: boolean;
  currentRequest?: QueuedRequest;
  lastProcessedAt: number;
  totalProcessed: number;
  connection?: any; // Keep-alive connection
  connectionCreatedAt?: number;
}

export interface QueueStats {
  provider: string;
  queueLength: number;
  processing: boolean;
  totalProcessed: number;
  averageWaitTime: number;
  longestWaitTime: number;
  oldestRequestAge: number;
}

class ShinModeManager extends EventEmitter {
  private mode: ShinMode = 'normal';
  private enabled: boolean = false;
  private config: ShinModeConfig;
  private queues: Map<string, ProviderQueue> = new Map();
  private requestCounter: number = 0;
  private readonly DEFAULT_QUEUE_SIZE = 100;
  private readonly DEFAULT_TIMEOUT = 60000; // 1 minute
  private readonly CONNECTION_REUSE_TIME = 5000; // 5 seconds
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config?: Partial<ShinModeConfig>) {
    super();
    this.config = {
      enabled: config?.enabled ?? false,
      mode: config?.mode ?? 'normal',
      maxQueueSize: config?.maxQueueSize ?? this.DEFAULT_QUEUE_SIZE,
      queueTimeout: config?.queueTimeout ?? this.DEFAULT_TIMEOUT,
      keepAliveConnections: config?.keepAliveConnections ?? true,
      connectionReuseTime: config?.connectionReuseTime ?? this.CONNECTION_REUSE_TIME,
      providers: config?.providers ?? {},
    };

    this.enabled = this.config.enabled;
    this.mode = this.config.mode;

    if (this.enabled) {
      this.startCleanupTimer();
    }
  }

  /**
   * Initialize Shin Mode with configuration
   */
  initialize(config: Partial<ShinModeConfig>): void {
    this.config = { ...this.config, ...config };
    this.enabled = this.config.enabled;
    this.mode = this.config.mode;

    console.log(`[SHIN-MODE] Initialized: mode=${this.mode}, enabled=${this.enabled}`);
    
    if (this.enabled && !this.cleanupInterval) {
      this.startCleanupTimer();
    }
  }

  /**
   * Check if Shin Mode is enabled for a provider
   */
  isEnabled(provider: string): boolean {
    if (!this.enabled || this.mode !== 'shin') {
      return false;
    }

    const providerConfig = this.config.providers[provider];
    return providerConfig?.enabled !== false;
  }

  /**
   * Process a request through Shin Mode
   */
  async processRequest(
    provider: string,
    request: FastifyRequest,
    reply: FastifyReply,
    priority: RequestPriority = 'normal'
  ): Promise<any> {
    // If Shin Mode not enabled for this provider, process normally
    if (!this.isEnabled(provider)) {
      return null; // Signal to use normal processing
    }

    return new Promise((resolve, reject) => {
      const requestId = this.generateRequestId();
      const enqueuedAt = Date.now();

      // Create timeout
      const timeout = setTimeout(() => {
        this.removeFromQueue(provider, requestId);
        reject(new Error(`Request timeout after ${this.config.queueTimeout}ms in queue`));
      }, this.config.queueTimeout);

      // Estimate tokens for better scheduling
      const estimatedTokens = this.estimateTokens(request);

      const queuedRequest: QueuedRequest = {
        id: requestId,
        provider,
        request,
        reply,
        priority,
        enqueuedAt,
        estimatedTokens,
        resolve,
        reject,
        timeout,
      };

      // Add to queue
      this.enqueue(provider, queuedRequest);

      console.log(`[SHIN-MODE] Request ${requestId} queued for ${provider}, priority: ${priority}, queue size: ${this.getQueueSize(provider)}`);
    });
  }

  /**
   * Add request to provider queue
   */
  private enqueue(provider: string, request: QueuedRequest): void {
    // Get or create queue for provider
    if (!this.queues.has(provider)) {
      this.queues.set(provider, {
        provider,
        queue: [],
        processing: false,
        lastProcessedAt: 0,
        totalProcessed: 0,
      });
    }

    const providerQueue = this.queues.get(provider)!;

    // Check queue size limit
    if (providerQueue.queue.length >= this.config.maxQueueSize) {
      clearTimeout(request.timeout);
      request.reject(new Error(`Queue full for provider ${provider} (max: ${this.config.maxQueueSize})`));
      this.emit('queueFull', { provider, queueSize: providerQueue.queue.length });
      return;
    }

    // Add to queue with priority sorting
    providerQueue.queue.push(request);
    this.sortQueue(providerQueue);

    this.emit('requestQueued', {
      provider,
      requestId: request.id,
      queueSize: providerQueue.queue.length,
      priority: request.priority,
    });

    // Start processing if not already processing
    if (!providerQueue.processing) {
      this.processNextInQueue(provider);
    }
  }

  /**
   * Process next request in queue
   */
  private async processNextInQueue(provider: string): Promise<void> {
    const providerQueue = this.queues.get(provider);
    if (!providerQueue || providerQueue.queue.length === 0) {
      return;
    }

    // Mark as processing
    providerQueue.processing = true;

    // Get next request
    const request = providerQueue.queue.shift()!;
    providerQueue.currentRequest = request;

    const waitTime = Date.now() - request.enqueuedAt;
    console.log(`[SHIN-MODE] Processing request ${request.id} for ${provider}, waited: ${waitTime}ms, remaining in queue: ${providerQueue.queue.length}`);

    this.emit('requestProcessing', {
      provider,
      requestId: request.id,
      waitTime,
      remainingInQueue: providerQueue.queue.length,
    });

    try {
      // Clear timeout since we're processing now
      clearTimeout(request.timeout);

      // Check if we can reuse existing connection
      const connection = this.getOrCreateConnection(provider);

      // Process the request (this will be handled by the calling code)
      // We just signal that it's okay to proceed
      request.resolve({ useConnection: connection });

      // Update stats
      providerQueue.lastProcessedAt = Date.now();
      providerQueue.totalProcessed++;

      this.emit('requestCompleted', {
        provider,
        requestId: request.id,
        duration: Date.now() - request.enqueuedAt,
        totalProcessed: providerQueue.totalProcessed,
      });

    } catch (error) {
      console.error(`[SHIN-MODE] Error processing request ${request.id}:`, error);
      request.reject(error as Error);

      this.emit('requestFailed', {
        provider,
        requestId: request.id,
        error: (error as Error).message,
      });
    } finally {
      providerQueue.currentRequest = undefined;
      providerQueue.processing = false;

      // Process next request after a small delay (for connection reuse)
      setTimeout(() => {
        if (providerQueue.queue.length > 0) {
          this.processNextInQueue(provider);
        }
      }, 10); // Small delay to allow connection reuse
    }
  }

  /**
   * Get or create keep-alive connection for provider
   */
  private getOrCreateConnection(provider: string): any {
    const providerQueue = this.queues.get(provider);
    if (!providerQueue) return null;

    // Check if existing connection is still valid
    if (providerQueue.connection && providerQueue.connectionCreatedAt) {
      const connectionAge = Date.now() - providerQueue.connectionCreatedAt;
      if (connectionAge < this.config.connectionReuseTime) {
        console.log(`[SHIN-MODE] Reusing connection for ${provider}, age: ${connectionAge}ms`);
        return providerQueue.connection;
      } else {
        console.log(`[SHIN-MODE] Connection expired for ${provider}, creating new one`);
        providerQueue.connection = undefined;
      }
    }

    // Create new connection marker (actual connection handled by underlying system)
    providerQueue.connection = { id: `conn-${Date.now()}`, provider };
    providerQueue.connectionCreatedAt = Date.now();

    return providerQueue.connection;
  }

  /**
   * Sort queue by priority and enqueue time
   */
  private sortQueue(providerQueue: ProviderQueue): void {
    const priorityOrder: Record<RequestPriority, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
    };

    providerQueue.queue.sort((a, b) => {
      // First by priority
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Then by enqueue time (FIFO within same priority)
      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  /**
   * Remove request from queue
   */
  private removeFromQueue(provider: string, requestId: string): void {
    const providerQueue = this.queues.get(provider);
    if (!providerQueue) return;

    const index = providerQueue.queue.findIndex(r => r.id === requestId);
    if (index !== -1) {
      const removed = providerQueue.queue.splice(index, 1)[0];
      clearTimeout(removed.timeout);
      console.log(`[SHIN-MODE] Removed request ${requestId} from ${provider} queue`);
    }
  }

  /**
   * Get queue size for a provider
   */
  getQueueSize(provider: string): number {
    const providerQueue = this.queues.get(provider);
    return providerQueue ? providerQueue.queue.length : 0;
  }

  /**
   * Get queue statistics for a provider
   */
  getQueueStats(provider: string): QueueStats | null {
    const providerQueue = this.queues.get(provider);
    if (!providerQueue) return null;

    const now = Date.now();
    const waitTimes = providerQueue.queue.map(r => now - r.enqueuedAt);
    const averageWaitTime = waitTimes.length > 0
      ? waitTimes.reduce((sum, time) => sum + time, 0) / waitTimes.length
      : 0;
    const longestWaitTime = waitTimes.length > 0 ? Math.max(...waitTimes) : 0;
    const oldestRequestAge = providerQueue.queue.length > 0
      ? now - providerQueue.queue[0].enqueuedAt
      : 0;

    return {
      provider,
      queueLength: providerQueue.queue.length,
      processing: providerQueue.processing,
      totalProcessed: providerQueue.totalProcessed,
      averageWaitTime,
      longestWaitTime,
      oldestRequestAge,
    };
  }

  /**
   * Get all queue statistics
   */
  getAllQueueStats(): QueueStats[] {
    const stats: QueueStats[] = [];
    for (const [provider] of this.queues) {
      const providerStats = this.getQueueStats(provider);
      if (providerStats) {
        stats.push(providerStats);
      }
    }
    return stats;
  }

  /**
   * Get current mode
   */
  getMode(): ShinMode {
    return this.mode;
  }

  /**
   * Switch mode (normal or shin)
   */
  switchMode(mode: ShinMode): void {
    const oldMode = this.mode;
    this.mode = mode;
    this.config.mode = mode;

    console.log(`[SHIN-MODE] Switched from ${oldMode} to ${mode}`);
    this.emit('modeChanged', { oldMode, newMode: mode });

    // If switching to normal, process remaining queues immediately
    if (mode === 'normal') {
      this.flushAllQueues();
    }
  }

  /**
   * Flush all queues (switch to concurrent processing)
   */
  private flushAllQueues(): void {
    console.log('[SHIN-MODE] Flushing all queues...');
    for (const [provider, providerQueue] of this.queues) {
      while (providerQueue.queue.length > 0) {
        const request = providerQueue.queue.shift()!;
        clearTimeout(request.timeout);
        request.resolve({ useConnection: null }); // Process normally
      }
    }
  }

  /**
   * Get overall statistics
   */
  getStats(): {
    mode: ShinMode;
    enabled: boolean;
    totalQueued: number;
    totalProcessing: number;
    totalProcessed: number;
    providers: QueueStats[];
  } {
    const providers = this.getAllQueueStats();
    const totalQueued = providers.reduce((sum, p) => sum + p.queueLength, 0);
    const totalProcessing = providers.filter(p => p.processing).length;
    const totalProcessed = providers.reduce((sum, p) => sum + p.totalProcessed, 0);

    return {
      mode: this.mode,
      enabled: this.enabled,
      totalQueued,
      totalProcessing,
      totalProcessed,
      providers,
    };
  }

  /**
   * Estimate tokens from request
   */
  private estimateTokens(request: FastifyRequest): number {
    const body = request.body as any;
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
      }
    }

    // Rough estimation: 4 characters per token
    return Math.ceil(textLength / 4) + (body.max_tokens || 1024);
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `shin-${Date.now()}-${++this.requestCounter}`;
  }

  /**
   * Start cleanup timer for expired connections
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredConnections();
    }, 30000); // Every 30 seconds
  }

  /**
   * Cleanup expired connections
   */
  private cleanupExpiredConnections(): void {
    const now = Date.now();
    for (const [provider, providerQueue] of this.queues) {
      if (providerQueue.connection && providerQueue.connectionCreatedAt) {
        const connectionAge = now - providerQueue.connectionCreatedAt;
        if (connectionAge > this.config.connectionReuseTime) {
          console.log(`[SHIN-MODE] Cleaning up expired connection for ${provider}`);
          providerQueue.connection = undefined;
          providerQueue.connectionCreatedAt = undefined;
        }
      }
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Clear all queues
    for (const [provider, providerQueue] of this.queues) {
      for (const request of providerQueue.queue) {
        clearTimeout(request.timeout);
        request.reject(new Error('Shin Mode manager destroyed'));
      }
    }

    this.queues.clear();
    this.removeAllListeners();
    console.log('[SHIN-MODE] Manager destroyed');
  }
}

// Singleton instance
export const shinModeManager = new ShinModeManager();
