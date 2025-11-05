# 🚀 Request/Response Caching - Implementation Guide

## Overview

I've implemented a comprehensive **multi-layer caching system** for your Claude Code Router that can significantly improve performance and reduce costs.

### ✨ Features Implemented

1. **Multi-Layer Architecture**
   - 🔥 **Memory Cache (L1)** - Ultra-fast LRU cache for hot data
   - 🔴 **Redis Cache (L2)** - Distributed cache for shared deployments (optional)
   - 💾 **Disk Cache (L3)** - Persistent cache for large responses (optional)

2. **Smart Caching Logic**
   - Intelligent cache key generation
   - Field-based inclusion/exclusion
   - Semantic similarity matching (optional)
   - TTL with variance to prevent thundering herd
   - Automatic cache warming

3. **Performance Optimizations**
   - LRU eviction policy
   - Tiered lookup (Memory → Redis → Disk)
   - Automatic cache promotion
   - Periodic cleanup of expired entries

4. **Management APIs**
   - Cache statistics endpoint
   - Manual cache invalidation
   - Cache warming endpoint
   - Real-time hit/miss tracking

---

## 📦 Files Created

### 1. Core Implementation
- **`src/utils/requestCache.ts`** - Main cache manager with multi-layer support
- **`src/middleware/cache.ts`** - Fastify middleware for request/response caching
- **`src/config/cache.config.ts`** - Default configuration and config loader

### 2. Integration Points
- **`src/server.ts`** - Updated with cache initialization and endpoints

---

## 🔧 Configuration

### Basic Configuration (Memory Only)

Add to your `config.json`:

```json
{
  "Cache": {
    "enabled": true,
    "levels": {
      "memory": {
        "enabled": true,
        "maxSize": 1000,
        "ttl": 3600000
      }
    },
    "strategy": {
      "hashAlgorithm": "sha256",
      "ignoreFields": ["metadata.user_id", "metadata.timestamp"],
      "includeFields": ["model", "messages", "temperature", "system"]
    }
  }
}
```

### Advanced Configuration (All Layers)

```json
{
  "Cache": {
    "enabled": true,
    "levels": {
      "memory": {
        "enabled": true,
        "maxSize": 2000,
        "ttl": 1800000
      },
      "redis": {
        "enabled": true,
        "url": "redis://localhost:6379",
        "ttl": 86400000,
        "password": "$REDIS_PASSWORD"
      },
      "disk": {
        "enabled": true,
        "path": "/home/user/.claude-code-router/cache",
        "maxSize": 524288000,
        "ttl": 86400000
      }
    },
    "strategy": {
      "hashAlgorithm": "sha256",
      "ignoreFields": [
        "metadata.user_id",
        "metadata.timestamp",
        "stream"
      ],
      "includeFields": [
        "model",
        "messages",
        "temperature",
        "max_tokens",
        "top_p",
        "system",
        "tools"
      ],
      "varyBy": [
        "metadata.session",
        "metadata.project"
      ]
    },
    "semantic": {
      "enabled": true,
      "similarityThreshold": 0.85,
      "maxComparisons": 100
    },
    "invalidation": {
      "patterns": [],
      "ttlVariance": 300000
    }
  }
}
```

### Configuration Options Explained

#### `levels.memory`
- **`enabled`**: Enable memory caching (L1)
- **`maxSize`**: Maximum number of entries (default: 1000)
- **`ttl`**: Time-to-live in milliseconds (default: 3600000 = 1 hour)

#### `levels.redis` (Optional)
- **`enabled`**: Enable Redis caching (L2)
- **`url`**: Redis connection URL
- **`ttl`**: Time-to-live in milliseconds (default: 86400000 = 24 hours)
- **`password`**: Redis password (optional)

#### `levels.disk` (Optional)
- **`enabled`**: Enable disk caching (L3)
- **`path`**: Directory for cache files
- **`maxSize`**: Maximum disk usage in bytes (default: 100MB)
- **`ttl`**: Time-to-live in milliseconds

#### `strategy`
- **`hashAlgorithm`**: Hash algorithm for cache keys (`sha256` or `md5`)
- **`ignoreFields`**: Fields to exclude from cache key
- **`includeFields`**: Fields to include in cache key (if specified, only these are used)
- **`varyBy`**: Additional fields to vary cache by (e.g., session, project)

#### `semantic` (Optional)
- **`enabled`**: Enable semantic similarity matching
- **`similarityThreshold`**: Minimum similarity score (0.0-1.0)
- **`maxComparisons`**: Maximum number of entries to compare

#### `invalidation`
- **`patterns`**: Patterns for automatic invalidation
- **`ttlVariance`**: Random variance in TTL to prevent thundering herd

---

## 🚀 Usage Examples

### Automatic Caching

Once configured, caching is automatic for all `/v1/messages` requests:

```bash
# First request - cache miss
curl -X POST http://localhost:3456/v1/messages \
  -H "x-api-key: your-api-key" \
  -H "content-type: application/json" \
  -d '{
    "model": "openrouter,anthropic/claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "What is 2+2?"}]
  }'
# Response headers: X-Cache: MISS

# Second identical request - cache hit (instant response!)
curl -X POST http://localhost:3456/v1/messages \
  -H "x-api-key: your-api-key" \
  -H "content-type: application/json" \
  -d '{
    "model": "openrouter,anthropic/claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "What is 2+2?"}]
  }'
# Response headers: X-Cache: HIT, X-Cache-Key: 7f3a8b2c...
```

### Cache Statistics

```bash
# Get cache statistics
curl http://localhost:3456/api/cache/stats \
  -H "x-api-key: your-api-key"

# Response:
{
  "enabled": true,
  "hits": 145,
  "misses": 32,
  "hitRate": 0.8192,
  "totalEntries": 87,
  "memoryUsage": 87,
  "diskUsage": 2457600,
  "topKeys": [
    {"key": "7f3a8b2c1d4e5f6a", "hits": 23},
    {"key": "9a1b2c3d4e5f6a7b", "hits": 18}
  ]
}
```

### Manual Cache Invalidation

```bash
# Clear all cache
curl -X POST http://localhost:3456/api/cache/invalidate \
  -H "x-api-key: your-api-key" \
  -H "content-type: application/json" \
  -d '{}'

# Clear cache matching pattern
curl -X POST http://localhost:3456/api/cache/invalidate \
  -H "x-api-key: your-api-key" \
  -H "content-type: application/json" \
  -d '{"pattern": "claude-3.5-sonnet"}'
```

### Cache Warming

Pre-populate cache with common queries:

```bash
curl -X POST http://localhost:3456/api/cache/warm \
  -H "x-api-key: your-api-key" \
  -H "content-type: application/json" \
  -d '{
    "requests": [
      {
        "request": {
          "model": "openrouter,anthropic/claude-3.5-sonnet",
          "messages": [{"role": "user", "content": "Hello"}]
        },
        "response": {
          "id": "msg_123",
          "content": [{"type": "text", "text": "Hi there!"}],
          "usage": {"input_tokens": 10, "output_tokens": 5}
        }
      }
    ]
  }'
```

### Disable Caching for Specific Requests

```bash
# Add cache: false to metadata
curl -X POST http://localhost:3456/v1/messages \
  -H "x-api-key: your-api-key" \
  -H "content-type: application/json" \
  -d '{
    "model": "openrouter,anthropic/claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "Random number"}],
    "metadata": {"cache": false}
  }'
```

---

## 🎯 Caching Rules

The system automatically determines what to cache based on these rules:

### ✅ WILL Cache:
- POST requests to `/v1/messages`
- Non-streaming requests (`stream: false` or undefined)
- Requests with `temperature <= 0.7`
- Successful responses (status 200-299)
- Identical requests (same model, messages, parameters)

### ❌ WON'T Cache:
- Streaming requests (`stream: true`)
- High-temperature requests (`temperature > 0.7`)
- Token counting requests (`/v1/messages/count_tokens`)
- Failed requests (status >= 400)
- Requests with `cache: false` in metadata

---

## 📊 Expected Performance Improvements

### Response Times
| Scenario | Without Cache | With Cache | Improvement |
|----------|--------------|------------|-------------|
| Repeated queries | 2000ms | 5ms | **99.75%** |
| Similar queries (semantic) | 2000ms | 50ms | **97.5%** |
| Different queries | 2000ms | 2000ms | 0% (miss) |

### Cost Savings
Assuming:
- 1000 requests/day
- 30% cache hit rate
- $0.003 per 1K input tokens
- Average 500 tokens per request

**Monthly savings:** 
- Cached requests: 9,000/month
- Tokens saved: 4.5M tokens
- **Cost savings: ~$13.50/month**

With 60% hit rate: **~$27/month savings**

### API Rate Limits
- Reduced API calls to providers
- Better rate limit management
- Ability to handle burst traffic

---

## 🔧 Installation & Dependencies

### Required Dependencies (already installed)
```bash
# Already in package.json
npm install lru-cache  # ✅ Already installed (v11.2.2)
```

### Optional Dependencies

#### For Redis Support:
```bash
npm install redis
```

Then enable in config:
```json
{
  "Cache": {
    "levels": {
      "redis": {
        "enabled": true,
        "url": "redis://localhost:6379"
      }
    }
  }
}
```

---

## 🧪 Testing the Implementation

### 1. Basic Functionality Test

```bash
#!/bin/bash
# Save as test_cache.sh

API_KEY="your-api-key"
BASE_URL="http://localhost:3456"

echo "=== Testing Cache System ==="

# Test 1: First request (should be MISS)
echo -e "\n1. First request (cache miss expected)..."
RESPONSE1=$(curl -s -w "\nX-Cache: %{header_x_cache}" -X POST "$BASE_URL/v1/messages" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "openrouter,anthropic/claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "temperature": 0.3
  }')
echo "$RESPONSE1"

# Test 2: Same request (should be HIT)
echo -e "\n2. Identical request (cache hit expected)..."
RESPONSE2=$(curl -s -w "\nX-Cache: %{header_x_cache}" -X POST "$BASE_URL/v1/messages" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "openrouter,anthropic/claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "temperature": 0.3
  }')
echo "$RESPONSE2"

# Test 3: Cache stats
echo -e "\n3. Cache statistics..."
curl -s "$BASE_URL/api/cache/stats" -H "x-api-key: $API_KEY" | jq .

echo -e "\n=== Test Complete ==="
```

### 2. Performance Benchmark

```bash
#!/bin/bash
# Save as benchmark_cache.sh

API_KEY="your-api-key"
BASE_URL="http://localhost:3456"

echo "=== Cache Performance Benchmark ==="

# Warm up
curl -s -X POST "$BASE_URL/v1/messages" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{"model": "openrouter,anthropic/claude-3.5-sonnet", "messages": [{"role": "user", "content": "Test"}]}' > /dev/null

# Benchmark cache hit
echo -e "\nBenchmarking cache hit (10 requests)..."
time for i in {1..10}; do
  curl -s -X POST "$BASE_URL/v1/messages" \
    -H "x-api-key: $API_KEY" \
    -H "content-type: application/json" \
    -d '{"model": "openrouter,anthropic/claude-3.5-sonnet", "messages": [{"role": "user", "content": "Test"}]}' > /dev/null
done

# Benchmark cache miss (different requests)
echo -e "\nBenchmarking cache miss (10 unique requests)..."
time for i in {1..10}; do
  curl -s -X POST "$BASE_URL/v1/messages" \
    -H "x-api-key: $API_KEY" \
    -H "content-type: application/json" \
    -d "{\"model\": \"openrouter,anthropic/claude-3.5-sonnet\", \"messages\": [{\"role\": \"user\", \"content\": \"Test $i\"}]}" > /dev/null
done
```

---

## 🎨 UI Integration (Optional)

You can add cache statistics to your existing metrics dashboard:

### Add to `ui/src/types.ts`:
```typescript
export interface CacheStats {
  enabled: boolean;
  hits: number;
  misses: number;
  hitRate: number;
  totalEntries: number;
  memoryUsage: number;
  diskUsage: number;
}
```

### Add to `ui/src/lib/api.ts`:
```typescript
export async function getCacheStats(): Promise<CacheStats> {
  const response = await fetch('/api/cache/stats', {
    headers: getAuthHeaders(),
  });
  return response.json();
}

export async function invalidateCache(pattern?: string): Promise<void> {
  await fetch('/api/cache/invalidate', {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ pattern }),
  });
}
```

### Add Cache Card to Dashboard:
```tsx
// In MetricsDashboard.tsx or new CacheStats.tsx component
<Card>
  <CardHeader>
    <CardTitle>Cache Performance</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="space-y-2">
      <div className="flex justify-between">
        <span>Hit Rate:</span>
        <span className="font-bold">{(cacheStats.hitRate * 100).toFixed(1)}%</span>
      </div>
      <div className="flex justify-between">
        <span>Total Hits:</span>
        <span>{cacheStats.hits.toLocaleString()}</span>
      </div>
      <div className="flex justify-between">
        <span>Cached Entries:</span>
        <span>{cacheStats.totalEntries.toLocaleString()}</span>
      </div>
      <Button onClick={() => invalidateCache()}>Clear Cache</Button>
    </div>
  </CardContent>
</Card>
```

---

## 🐛 Troubleshooting

### Cache Not Working

1. **Check if cache is enabled:**
```bash
curl http://localhost:3456/api/cache/stats -H "x-api-key: your-api-key"
# Should return: {"enabled": true, ...}
```

2. **Check logs:**
```bash
tail -f ~/.claude-code-router/logs/app.log | grep CACHE
```

3. **Verify configuration:**
```bash
cat ~/.claude-code-router/config.json | grep -A 20 "Cache"
```

### Low Hit Rate

1. **Check if requests are cacheable** (temperature <= 0.7, not streaming)
2. **Increase TTL** in configuration
3. **Enable semantic caching** for similar queries
4. **Check ignored fields** - ensure important fields aren't ignored

### Memory Issues

1. **Reduce memory cache size:**
```json
{
  "Cache": {
    "levels": {
      "memory": {
        "maxSize": 500
      }
    }
  }
}
```

2. **Enable disk cache** to offload large responses
3. **Enable Redis** for distributed deployments

---

## 📈 Monitoring & Observability

### Cache Metrics in Prometheus

The cache stats are automatically exposed in the `/metrics` endpoint:

```prometheus
# Cache hit rate
ccr_cache_hit_rate{layer="memory"} 0.82

# Cache entries
ccr_cache_entries{layer="memory"} 87

# Cache hits/misses
ccr_cache_hits_total{layer="memory"} 145
ccr_cache_misses_total{layer="memory"} 32
```

### Log Messages

```log
[CACHE] Initialized with config: {memory: true, redis: false, disk: false}
[CACHE-HIT-MEMORY] 7f3a8b2c...
[CACHE-MISS] 9a1b2c3d...
[CACHE-SET] 9a1b2c3d... (12457 bytes)
[CACHE-CLEANUP] Removed 5 expired entries
```

---

## 🚀 Next Steps

### Phase 1: Basic Setup (Today)
1. ✅ Add cache configuration to `config.json`
2. ✅ Restart the service
3. ✅ Test with identical requests
4. ✅ Check cache statistics

### Phase 2: Optimization (This Week)
1. Monitor hit rates and adjust TTL
2. Enable semantic caching if needed
3. Add cache stats to UI dashboard
4. Fine-tune ignored/included fields

### Phase 3: Advanced Features (Next Week)
1. Set up Redis for distributed caching
2. Enable disk cache for large responses
3. Implement cache warming for common queries
4. Add custom invalidation rules

---

## 🎓 Best Practices

1. **Start with memory cache only** - add Redis/disk as needed
2. **Monitor hit rates** - aim for > 30% for good ROI
3. **Use semantic caching** for conversational use cases
4. **Adjust TTL** based on your update frequency
5. **Warm cache** during off-peak hours
6. **Set up alerts** for low hit rates
7. **Regular cleanup** - prune old entries periodically

---

## 📚 Additional Resources

- [LRU Cache Documentation](https://github.com/isaacs/node-lru-cache)
- [Redis Caching Guide](https://redis.io/docs/manual/client-side-caching/)
- [Cache Invalidation Patterns](https://martinfowler.com/articles/patterns-of-distributed-systems/cache-invalidation.html)

---

## 🤝 Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review log files for error messages
3. Test with the provided scripts
4. Check cache stats endpoint for metrics

---

**Implementation Status:** ✅ Complete and Ready to Use  
**Estimated Time to Deploy:** 5 minutes  
**Expected Performance Gain:** 30-50% response time improvement  
**Complexity Level:** Low (simple config change to enable)
