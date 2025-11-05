# Metrics System Upgrade Checklist

## Pre-Deployment Verification

### Build & Compilation
- [x] TypeScript compilation successful
- [x] No type errors
- [x] All imports resolved
- [x] Build artifacts generated

### Code Quality
- [x] Error handling added to all critical paths
- [x] Logging standardized with prefixes
- [x] Input validation implemented
- [x] Graceful degradation on failures

### Database
- [x] Schema compatible (no breaking changes)
- [x] New indexes added for performance
- [x] Error handling for all queries
- [x] Transaction safety maintained

## Post-Deployment Testing

### 1. Basic Functionality Test
```bash
# Start the server
npm start

# Verify metrics endpoints are accessible
curl http://localhost:3456/api/metrics/realtime
curl http://localhost:3456/api/metrics/summary
```

### 2. Token Tracking Test
```bash
# Make a test request
curl -X POST http://localhost:3456/v1/messages \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic,claude-3-5-sonnet-20241022",
    "messages": [{"role": "user", "content": "Hello, how are you?"}],
    "max_tokens": 100
  }'

# Verify tokens were tracked
curl http://localhost:3456/api/metrics/realtime | jq '.totalInputTokens, .totalOutputTokens'
```

### 3. Error Handling Test
```bash
# Test with invalid auth (should record error metrics)
curl -X POST http://localhost:3456/v1/messages \
  -H "x-api-key: invalid_key" \
  -H "Content-Type: application/json" \
  -d '{}'

# Check error rate
curl http://localhost:3456/api/metrics/realtime | jq '.errorRate'
```

### 4. Database Persistence Test
```bash
# Check database stats
curl http://localhost:3456/api/metrics/database-stats | jq

# Verify data is being persisted
curl "http://localhost:3456/api/metrics/historical?hours=1" | jq

# Force flush pending metrics
curl -X POST http://localhost:3456/api/metrics/flush
```

### 5. Real-Time Streaming Test
```bash
# Connect to metrics stream (leave running)
curl -N http://localhost:3456/api/metrics/stream

# In another terminal, make requests and watch updates
```

### 6. Provider Metrics Test
```bash
# Check provider-specific metrics
curl http://localhost:3456/api/metrics/providers | jq

# Check top models
curl http://localhost:3456/api/metrics/top-models | jq
```

### 7. Cost Analytics Test
```bash
# Check cost analytics
curl "http://localhost:3456/api/metrics/cost-analytics?days=7" | jq
```

## Monitoring Checklist

### Logs to Monitor
- [ ] `[METRICS-MIDDLEWARE]` - Session initialization
- [ ] `[COLLECT-RESPONSE]` - Token extraction
- [ ] `[METRICS]` - Request recording and batch flushing
- [ ] `[METRICS-DB]` - Database operations

### Key Metrics to Watch
- [ ] Total requests per minute (RPM)
- [ ] Tokens per second (TPS)
- [ ] Error rate (should be < 5%)
- [ ] Average latency
- [ ] Database size growth
- [ ] Active sessions count

### Performance Indicators
- [ ] Batch flush succeeds regularly
- [ ] No memory leaks (check with `process.memoryUsage()`)
- [ ] Database queries complete quickly (< 50ms)
- [ ] Real-time updates stream without lag

## Rollback Plan

If issues are detected:

1. **Check logs** for error patterns
2. **Verify database** integrity at `~/.claude-code-router/data/metrics.db`
3. **Force flush** pending metrics: `curl -X POST http://localhost:3456/api/metrics/flush`
4. **Restart service** if needed

Database is backward compatible - no rollback needed for schema.

## Success Criteria

- ✅ All API endpoints respond correctly
- ✅ Tokens are being tracked (check realtime metrics)
- ✅ Errors are being recorded with proper types
- ✅ Database is persisting data
- ✅ No errors in logs (except expected test errors)
- ✅ Real-time stream works
- ✅ Historical queries return data

## Known Good State Indicators

```bash
# Check overall health
curl http://localhost:3456/api/metrics/summary | jq '{
  totalRequests: .realTime.totalRequests,
  errorRate: .realTime.errorRate,
  activeSessions: .realTime.activeSessions,
  tps: .realTime.tokensPerSecond,
  dbSize: (.tokenAnalytics.totalTokens // 0)
}'
```

Expected output:
- `totalRequests` > 0 (after making requests)
- `errorRate` < 10 (ideally < 5)
- `activeSessions` >= 0
- `tps` >= 0
- `dbSize` > 0 (after persistence)

## Troubleshooting

### Issue: No tokens being tracked
**Check:**
1. Look for `[COLLECT-RESPONSE]` logs
2. Verify session cache is working
3. Check response data extraction

### Issue: High error rate
**Check:**
1. Provider connectivity
2. API key validity
3. Error type distribution in metrics

### Issue: Database errors
**Check:**
1. Disk space available
2. File permissions on `~/.claude-code-router/data/`
3. Database file not corrupted

### Issue: Memory growing
**Check:**
1. Batch flush is working (look for flush logs)
2. Old data cleanup is running (hourly)
3. Request history not exceeding 10K limit

## Post-Verification

After confirming all tests pass:

1. ✅ Mark deployment as successful
2. ✅ Document any issues found
3. ✅ Set up ongoing monitoring
4. ✅ Schedule periodic database cleanup review
5. ✅ Update team on new capabilities

## Additional Resources

- See `METRICS_FIX_SUMMARY.md` for detailed changes
- Check API documentation for endpoint details
- Review logs in `~/.claude-code-router/logs/`
