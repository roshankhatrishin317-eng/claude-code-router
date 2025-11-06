import crypto from 'crypto';
import { Redis } from 'ioredis';
import { RedisUtils } from './redis';

export interface DedupEntry {
  requestId: string;
  timestamp: number;
  ttl: number;
  response?: any;
  completed: boolean;
  waitingClients: string[];
}

export interface DedupOptions {
  keyPrefix?: string;
  defaultTTL?: number;
  maxWaitTime?: number;
  cleanupInterval?: number;
  enabled?: boolean;
}

export class RequestDeduplicator {
  private redis: Redis;
  private keyPrefix: string;
  private defaultTTL: number;
  private maxWaitTime: number;
  private cleanupInterval: number;
  private enabled: boolean;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(redis: Redis, options: DedupOptions = {}) {
    this.redis = redis;
    this.keyPrefix = options.keyPrefix || 'dedup';
    this.defaultTTL = options.defaultTTL || 30000; // 30 seconds
    this.maxWaitTime = options.maxWaitTime || 60000; // 1 minute
    this.cleanupInterval = options.cleanupInterval || 60000; // 1 minute
    this.enabled = options.enabled !== false;

    if (this.enabled) {
      this.startCleanupTimer();
    }
  }

  private generateRequestHash(request: any): string {
    try {
      // Extract relevant fields for deduplication
      const dedupFields = {
        model: request.model,
        messages: request.messages?.map((msg: any) => ({
          role: msg.role,
          content: msg.content
        })),
        system: request.system,
        tools: request.tools,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: request.stream
      };

      const normalized = JSON.stringify(dedupFields, Object.keys(dedupFields).sort());
      return crypto.createHash('sha256').update(normalized).digest('hex');
    } catch (error) {
      console.error('[DEDUP] Failed to generate request hash:', error);
      // Fallback to simple hash
      return crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
    }
  }

  private generateDedupKey(hash: string): string {
    return RedisUtils.generateKey(this.keyPrefix, hash);
  }

  private generateWaitingKey(clientId: string): string {
    return RedisUtils.generateKey(this.keyPrefix, 'waiting', clientId);
  }

  async checkDuplicate(request: any, clientId?: string): Promise<{
    isDuplicate: boolean;
    requestId?: string;
    existingResponse?: any;
    shouldWait?: boolean;
  }> {
    if (!this.enabled) {
      return { isDuplicate: false };
    }

    try {
      const hash = this.generateRequestHash(request);
      const dedupKey = this.generateDedupKey(hash);

      const existing = await this.redis.get(dedupKey);
      if (!existing) {
        return { isDuplicate: false };
      }

      const entry: DedupEntry = RedisUtils.deserialize(existing);
      if (!entry) {
        // Corrupted entry, clean it up
        await this.redis.del(dedupKey);
        return { isDuplicate: false };
      }

      const now = Date.now();

      // Check if entry has expired
      if (now - entry.timestamp > entry.ttl) {
        await this.redis.del(dedupKey);
        return { isDuplicate: false };
      }

      // If the request is completed and has a response, return it
      if (entry.completed && entry.response) {
        return {
          isDuplicate: true,
          requestId: entry.requestId,
          existingResponse: entry.response,
          shouldWait: false
        };
      }

      // If request is still in progress and we have a client ID, add to waiting list
      if (clientId && !entry.completed) {
        const waitingKey = this.generateWaitingKey(clientId);
        await this.redis.setex(waitingKey, Math.ceil(this.maxWaitTime / 1000), JSON.stringify({
          requestId: entry.requestId,
          hash,
          timestamp: now
        }));

        if (!entry.waitingClients.includes(clientId)) {
          entry.waitingClients.push(clientId);
          await this.redis.setex(dedupKey, Math.ceil(entry.ttl / 1000), RedisUtils.serialize(entry));
        }

        return {
          isDuplicate: true,
          requestId: entry.requestId,
          shouldWait: true
        };
      }

      return {
        isDuplicate: true,
        requestId: entry.requestId,
        shouldWait: true
      };

    } catch (error) {
      console.error('[DEDUP] Failed to check duplicate:', error);
      return { isDuplicate: false };
    }
  }

  async registerRequest(request: any, clientId?: string): Promise<{
    requestId: string;
    isNew: boolean;
  }> {
    if (!this.enabled) {
      return {
        requestId: this.generateRequestId(),
        isNew: true
      };
    }

    try {
      const hash = this.generateRequestHash(request);
      const dedupKey = this.generateDedupKey(hash);
      const now = Date.now();
      const requestId = this.generateRequestId();

      // Check if already exists
      const existing = await this.redis.get(dedupKey);
      if (existing) {
        const entry: DedupEntry = RedisUtils.deserialize(existing);
        if (entry && !entry.completed) {
          return { requestId: entry.requestId, isNew: false };
        }
      }

      // Create new entry
      const entry: DedupEntry = {
        requestId,
        timestamp: now,
        ttl: this.defaultTTL,
        completed: false,
        waitingClients: clientId ? [clientId] : []
      };

      await this.redis.setex(dedupKey, Math.ceil(this.defaultTTL / 1000), RedisUtils.serialize(entry));

      return { requestId, isNew: true };

    } catch (error) {
      console.error('[DEDUP] Failed to register request:', error);
      return {
        requestId: this.generateRequestId(),
        isNew: true
      };
    }
  }

  async completeRequest(requestId: string, response: any): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      // Find the entry by requestId
      const pattern = `${this.keyPrefix}:*`;
      const keys = await this.redis.keys(pattern);

      for (const key of keys) {
        if (key.includes('waiting')) continue; // Skip waiting client keys

        const existing = await this.redis.get(key);
        if (existing) {
          const entry: DedupEntry = RedisUtils.deserialize(existing);
          if (entry && entry.requestId === requestId) {
            entry.completed = true;
            entry.response = response;

            // Update the entry with response
            await this.redis.setex(key, Math.ceil(entry.ttl / 1000), RedisUtils.serialize(entry));

            // Notify waiting clients
            await this.notifyWaitingClients(entry.requestId, response, entry.waitingClients);
            break;
          }
        }
      }

    } catch (error) {
      console.error('[DEDUP] Failed to complete request:', error);
    }
  }

  private async notifyWaitingClients(requestId: string, response: any, clientIds: string[]): Promise<void> {
    const notifyPromises = clientIds.map(async (clientId) => {
      try {
        const waitingKey = this.generateWaitingKey(clientId);
        const waitingData = await this.redis.get(waitingKey);

        if (waitingData) {
          const data = JSON.parse(waitingData);
          if (data.requestId === requestId) {
            // Update waiting data with response
            data.response = response;
            data.completed = true;
            await this.redis.setex(waitingKey, Math.ceil(this.maxWaitTime / 1000), JSON.stringify(data));
          }
        }
      } catch (error) {
        console.error(`[DEDUP] Failed to notify client ${clientId}:`, error);
      }
    });

    await Promise.allSettled(notifyPromises);
  }

  async waitForResponse(clientId: string, timeout?: number): Promise<{
    response?: any;
    timeout: boolean;
    requestId?: string;
  }> {
    if (!this.enabled) {
      return { timeout: true };
    }

    try {
      const waitingKey = this.generateWaitingKey(clientId);
      const maxWait = timeout || this.maxWaitTime;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        const waitingData = await this.redis.get(waitingKey);
        if (waitingData) {
          const data = JSON.parse(waitingData);
          if (data.completed && data.response) {
            // Clean up waiting key
            await this.redis.del(waitingKey);
            return {
              response: data.response,
              timeout: false,
              requestId: data.requestId
            };
          }
        }

        // Wait 100ms before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Timeout occurred, clean up waiting key
      await this.redis.del(waitingKey);
      return { timeout: true };

    } catch (error) {
      console.error(`[DEDUP] Failed to wait for response for client ${clientId}:`, error);
      return { timeout: true };
    }
  }

  async cancelWaiting(clientId: string): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const waitingKey = this.generateWaitingKey(clientId);
      await this.redis.del(waitingKey);
    } catch (error) {
      console.error(`[DEDUP] Failed to cancel waiting for client ${clientId}:`, error);
    }
  }

  private async cleanupExpiredEntries(): Promise<void> {
    try {
      const pattern = `${this.keyPrefix}:*`;
      const keys = await this.redis.keys(pattern);
      const now = Date.now();

      for (const key of keys) {
        try {
          // Skip waiting client keys
          if (key.includes('waiting')) {
            // Clean up expired waiting entries
            const ttl = await this.redis.ttl(key);
            if (ttl === -2 || ttl === -1) {
              await this.redis.del(key);
            }
            continue;
          }

          const existing = await this.redis.get(key);
          if (existing) {
            const entry: DedupEntry = RedisUtils.deserialize(existing);
            if (entry && (now - entry.timestamp > entry.ttl)) {
              await this.redis.del(key);
            }
          }
        } catch (error) {
          // Clean up corrupted entries
          await this.redis.del(key);
        }
      }
    } catch (error) {
      console.error('[DEDUP] Failed to cleanup expired entries:', error);
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries().catch(error => {
        console.error('[DEDUP] Cleanup error:', error);
      });
    }, this.cleanupInterval);
  }

  async getStats(): Promise<{
    totalRequests: number;
    pendingRequests: number;
    waitingClients: number;
    enabled: boolean;
  }> {
    if (!this.enabled) {
      return {
        totalRequests: 0,
        pendingRequests: 0,
        waitingClients: 0,
        enabled: false
      };
    }

    try {
      const pattern = `${this.keyPrefix}:*`;
      const keys = await this.redis.keys(pattern);
      const now = Date.now();

      let totalRequests = 0;
      let pendingRequests = 0;
      let waitingClients = 0;

      for (const key of keys) {
        if (key.includes('waiting')) {
          waitingClients++;
        } else {
          try {
            const existing = await this.redis.get(key);
            if (existing) {
              const entry: DedupEntry = RedisUtils.deserialize(existing);
              if (entry) {
                totalRequests++;
                if (!entry.completed && (now - entry.timestamp <= entry.ttl)) {
                  pendingRequests++;
                }
              }
            }
          } catch (error) {
            // Skip corrupted entries
          }
        }
      }

      return {
        totalRequests,
        pendingRequests,
        waitingClients,
        enabled: true
      };

    } catch (error) {
      console.error('[DEDUP] Failed to get stats:', error);
      return {
        totalRequests: 0,
        pendingRequests: 0,
        waitingClients: 0,
        enabled: true
      };
    }
  }

  async clear(): Promise<void> {
    try {
      const pattern = `${this.keyPrefix}:*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error('[DEDUP] Failed to clear dedup data:', error);
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

export function createRequestDeduplicator(redis: Redis, options?: DedupOptions): RequestDeduplicator {
  return new RequestDeduplicator(redis, options);
}