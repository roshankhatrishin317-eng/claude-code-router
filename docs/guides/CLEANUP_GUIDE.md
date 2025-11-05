# Resource Cleanup Guide

## Overview
This guide documents all cleanup functions added to prevent memory leaks in the Claude Code Router.

## Cleanup Functions

### 1. Metrics Collector
**File:** `src/utils/metrics.ts`

```typescript
import { metricsCollector } from './utils/metrics';

// On application shutdown:
metricsCollector.cleanup();
```

**What it cleans:**
- Cleanup interval (runs every 1 minute)
- Batch flush interval (runs every 5 seconds)
- Database cleanup interval (runs every 1 hour)
- Flushes any pending metrics before cleanup

---

### 2. Alerting Manager
**File:** `src/utils/alerting.ts`

```typescript
import { alertingManager } from './utils/alerting';

// On application shutdown:
alertingManager.cleanup();
```

**What it cleans:**
- Alert evaluation interval (runs every 30 seconds)

---

### 3. Real-Time Token Tracker
**File:** `src/utils/realTimeTokenTracker.ts`

```typescript
import { realTimeTokenTracker } from './utils/realTimeTokenTracker';

// On application shutdown:
realTimeTokenTracker.destroy();
```

**What it cleans:**
- Token cleanup interval (runs every 5 seconds)
- Token buffers
- Token history

---

### 4. Circuit Breaker Health Check
**File:** `src/utils/circuitBreaker.ts`

```typescript
import { cleanupCircuitBreakerHealthCheck } from './utils/circuitBreaker';

// On application shutdown:
cleanupCircuitBreakerHealthCheck();
```

**What it cleans:**
- Health check interval (runs every 1 minute)

---

### 5. Auth Manager
**File:** `src/utils/auth.ts`

```typescript
import { cleanupAuthManagerInterval } from './utils/auth';

// On application shutdown:
cleanupAuthManagerInterval();
```

**What it cleans:**
- Token cleanup interval (runs every 1 hour)

---

## Recommended Shutdown Sequence

Add this to your application shutdown handler:

```typescript
// Example shutdown handler
async function gracefulShutdown() {
  console.log('Starting graceful shutdown...');
  
  try {
    // 1. Stop accepting new requests
    // server.close();
    
    // 2. Cleanup metrics and monitoring
    metricsCollector.cleanup();
    alertingManager.cleanup();
    realTimeTokenTracker.destroy();
    
    // 3. Cleanup authentication
    cleanupAuthManagerInterval();
    
    // 4. Cleanup circuit breakers
    cleanupCircuitBreakerHealthCheck();
    
    // 5. Close database connections
    // metricsDatabase.close();
    
    console.log('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

---

## Why This Matters

### Memory Leaks
Without cleanup, intervals continue running even after the application should stop, causing:
- Memory leaks
- Zombie processes
- Resource exhaustion
- Difficulty in testing

### Best Practices
1. **Always store interval references** - Don't use anonymous `setInterval`
2. **Create cleanup methods** - Every class with intervals should have cleanup
3. **Call cleanup on shutdown** - Register process handlers
4. **Test cleanup** - Verify resources are released

### Testing Cleanup

```typescript
// Test that intervals are cleared
describe('Cleanup', () => {
  it('should clear all intervals', async () => {
    // Create instance
    const collector = new MetricsCollector();
    
    // Verify intervals are running
    expect(collector['cleanupInterval']).toBeDefined();
    
    // Call cleanup
    collector.cleanup();
    
    // Verify intervals are cleared
    expect(collector['cleanupInterval']).toBeUndefined();
  });
});
```

---

## Monitoring

To monitor if cleanup is working properly:

```typescript
// Before cleanup
const beforeIntervals = process._getActiveHandles().length;

// Call cleanup functions
gracefulShutdown();

// After cleanup
const afterIntervals = process._getActiveHandles().length;

console.log(`Cleaned up ${beforeIntervals - afterIntervals} intervals/timers`);
```

---

## Future Improvements

1. **Automatic Cleanup Detection** - Lint rules to detect uncleaned intervals
2. **Resource Tracking** - Track all created resources for automatic cleanup
3. **Cleanup Registry** - Central registry of cleanup functions
4. **Health Checks** - Monitor for resource leaks in production

---

## Related Files

- `src/utils/metrics.ts` - Metrics collection with cleanup
- `src/utils/alerting.ts` - Alert system with cleanup
- `src/utils/realTimeTokenTracker.ts` - Token tracking with cleanup
- `src/utils/circuitBreaker.ts` - Circuit breaker with cleanup
- `src/utils/auth.ts` - Authentication with cleanup
- `src/utils/sessionAffinity.ts` - Session management with cleanup (already had close())
- `src/utils/connectionManager.ts` - Connection pooling with cleanup (already had close())

---

## Questions?

If you need to add cleanup to other modules, follow this pattern:

1. Store interval reference as class property
2. Create cleanup/destroy/close method
3. Clear intervals and reset state
4. Export cleanup function if needed
5. Call cleanup on application shutdown
