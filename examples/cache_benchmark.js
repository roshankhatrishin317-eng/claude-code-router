#!/usr/bin/env node

/**
 * Cache Performance Benchmark
 * 
 * This script benchmarks the cache performance with various scenarios
 */

const https = require('https');
const http = require('http');

const API_KEY = process.env.APIKEY || 'your-api-key';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3456';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function makeRequest(payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}/v1/messages`);
    const client = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'content-type': 'application/json',
      },
    };

    const startTime = Date.now();
    let cacheHeader = '';

    const req = client.request(options, (res) => {
      cacheHeader = res.headers['x-cache'] || 'UNKNOWN';
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const endTime = Date.now();
        const duration = endTime - startTime;

        resolve({
          duration,
          cache: cacheHeader,
          statusCode: res.statusCode,
          data: data.length > 0 ? JSON.parse(data) : null,
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function getCacheStats() {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}/api/cache/stats`);
    const client = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      headers: {
        'x-api-key': API_KEY,
      },
    };

    const req = client.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve(JSON.parse(data));
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function clearCache() {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}/api/cache/invalidate`);
    const client = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'content-type': 'application/json',
      },
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(JSON.parse(data));
      });
    });

    req.on('error', reject);
    req.write('{}');
    req.end();
  });
}

async function benchmark() {
  log('╔════════════════════════════════════════════╗', 'cyan');
  log('║   Cache Performance Benchmark Suite       ║', 'cyan');
  log('╚════════════════════════════════════════════╝', 'cyan');
  console.log();

  const testPayload = {
    model: 'openrouter,anthropic/claude-3.5-sonnet',
    messages: [{ role: 'user', content: 'What is 2+2? Just give the number.' }],
    temperature: 0.3,
    max_tokens: 10,
  };

  // Clear cache before starting
  log('Clearing cache...', 'yellow');
  await clearCache();
  console.log();

  // Test 1: Cache Miss Performance
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
  log('Test 1: Cache Miss Performance (Cold Start)', 'blue');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');

  const missResults = [];
  for (let i = 0; i < 5; i++) {
    const uniquePayload = {
      ...testPayload,
      messages: [{ role: 'user', content: `Test ${i}: What is ${i}+${i}?` }],
    };
    const result = await makeRequest(uniquePayload);
    missResults.push(result.duration);
    log(`  Request ${i + 1}: ${result.duration}ms (${result.cache})`, 'yellow');
  }

  const avgMiss = missResults.reduce((a, b) => a + b, 0) / missResults.length;
  log(`  Average: ${avgMiss.toFixed(0)}ms`, 'green');
  console.log();

  // Test 2: Cache Hit Performance
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
  log('Test 2: Cache Hit Performance (Warm Cache)', 'blue');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');

  // First request to populate cache
  await makeRequest(testPayload);
  log('  Cache warmed up...', 'yellow');

  const hitResults = [];
  for (let i = 0; i < 10; i++) {
    const result = await makeRequest(testPayload);
    hitResults.push(result.duration);
    log(`  Request ${i + 1}: ${result.duration}ms (${result.cache})`, 'yellow');
  }

  const avgHit = hitResults.reduce((a, b) => a + b, 0) / hitResults.length;
  log(`  Average: ${avgHit.toFixed(0)}ms`, 'green');
  console.log();

  // Test 3: Mixed Workload
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
  log('Test 3: Mixed Workload (70% Hits, 30% Misses)', 'blue');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');

  const mixedResults = { hits: [], misses: [] };
  for (let i = 0; i < 20; i++) {
    const useCache = Math.random() < 0.7; // 70% cache hits
    const payload = useCache
      ? testPayload
      : {
          ...testPayload,
          messages: [{ role: 'user', content: `Random ${Math.random()}: What is X?` }],
        };

    const result = await makeRequest(payload);
    if (result.cache.includes('HIT')) {
      mixedResults.hits.push(result.duration);
    } else {
      mixedResults.misses.push(result.duration);
    }
    log(`  Request ${i + 1}: ${result.duration}ms (${result.cache})`, 'yellow');
  }

  const avgMixedHit = mixedResults.hits.length > 0
    ? mixedResults.hits.reduce((a, b) => a + b, 0) / mixedResults.hits.length
    : 0;
  const avgMixedMiss = mixedResults.misses.length > 0
    ? mixedResults.misses.reduce((a, b) => a + b, 0) / mixedResults.misses.length
    : 0;

  log(`  Cache Hits: ${mixedResults.hits.length} (avg: ${avgMixedHit.toFixed(0)}ms)`, 'green');
  log(`  Cache Misses: ${mixedResults.misses.length} (avg: ${avgMixedMiss.toFixed(0)}ms)`, 'green');
  console.log();

  // Final Statistics
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('Final Results', 'cyan');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  const cacheStats = await getCacheStats();
  const speedup = (avgMiss / avgHit).toFixed(2);
  const improvement = (((avgMiss - avgHit) / avgMiss) * 100).toFixed(1);

  log(`\n📊 Performance Metrics:`, 'green');
  log(`  • Cache Miss Average: ${avgMiss.toFixed(0)}ms`);
  log(`  • Cache Hit Average:  ${avgHit.toFixed(0)}ms`);
  log(`  • Speedup:           ${speedup}x faster`, 'green');
  log(`  • Improvement:       ${improvement}% faster`, 'green');

  log(`\n📈 Cache Statistics:`, 'green');
  log(`  • Total Hits:    ${cacheStats.hits}`);
  log(`  • Total Misses:  ${cacheStats.misses}`);
  log(`  • Hit Rate:      ${(cacheStats.hitRate * 100).toFixed(1)}%`);
  log(`  • Cached Entries: ${cacheStats.totalEntries}`);

  log(`\n💡 Cost Savings (estimated):`, 'green');
  const monthlyCalls = 10000;
  const hitRate = cacheStats.hitRate;
  const cachedCalls = monthlyCalls * hitRate;
  const avgTokensPerCall = 500;
  const costPer1kTokens = 0.003;
  const tokensSaved = cachedCalls * avgTokensPerCall;
  const costSaved = (tokensSaved / 1000) * costPer1kTokens;

  log(`  • Assuming ${monthlyCalls} calls/month at ${(hitRate * 100).toFixed(0)}% hit rate`);
  log(`  • Tokens saved: ${tokensSaved.toLocaleString()}`);
  log(`  • Estimated savings: $${costSaved.toFixed(2)}/month`, 'green');

  log(`\n✅ Benchmark Complete!`, 'cyan');
  console.log();
}

// Run benchmark
benchmark().catch((error) => {
  console.error('Error running benchmark:', error);
  process.exit(1);
});
