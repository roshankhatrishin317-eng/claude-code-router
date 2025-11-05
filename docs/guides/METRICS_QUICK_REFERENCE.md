# Metrics System - Quick Reference Guide

## 🎯 Overview

The metrics and tracking system has been completely fixed and upgraded with:
- ✅ Robust error handling
- ✅ Accurate token tracking
- ✅ Real-time TPS calculation
- ✅ Database persistence
- ✅ Comprehensive logging

## 📊 API Endpoints

### Real-Time Metrics
```bash
GET /api/metrics/realtime
```
Returns: RPM, TPS, active sessions, error rate, latency percentiles

### Provider Metrics
```bash
GET /api/metrics/providers
```
Returns: Per-provider requests, tokens, costs, latency

### Session Metrics
```bash
GET /api/metrics/sessions
```
Returns: Active session details with token usage

### Historical Data
```bash
GET /api/metrics/history?limit=100
```
Returns: Last N request records

### Summary
```bash
GET /api/metrics/summary
```
Returns: Complete metrics overview including token analytics

### Token Analytics
```bash
GET /api/metrics/tokens
```
Returns: Token usage, costs, top models, hourly breakdown

### Database Stats
```bash
GET /api/metrics/database-stats
```
Returns: Total requests, DB size, date range, providers

### Historical Analytics
```bash
GET /api/metrics/historical?hours=24&provider=openai&model=gpt-4
```
Returns: Aggregated historical data with filters

### Cost Analytics
```bash
GET /api/metrics/cost-analytics?days=30
```
Returns: Daily cost breakdown by provider

### Top Models
```bash
GET /api/metrics/top-models?limit=10
```
Returns: Most used models by token volume

### Real-Time Stream (SSE)
```bash
GET /api/metrics/stream
```
Returns: Server-Sent Events stream with 100ms updates

### Force Flush
```bash
POST /api/metrics/flush
```
Immediately persist pending metrics to database

## 🔧 Key Improvements

### 1. Token Extraction
- ✅ Works for streaming and non-streaming responses
- ✅ Multiple fallback strategies
- ✅ Estimates when exact counts unavailable

### 2. Error Handling
- ✅ All database operations protected
- ✅ Metrics recorded even on extraction failure
- ✅ Graceful degradation everywhere

### 3. Performance
- ✅ Batch inserts (100 records)
- ✅ Auto-flush every 5 seconds
- ✅ Optimized indexes
- ✅ Efficient cleanup

### 4. Data Quality
- ✅ Input validation
- ✅ Error type classification
- ✅ Consistent session tracking
- ✅ Null safety

## 🐛 Fixed Issues

| Issue | Status | Description |
|-------|--------|-------------|
| Token extraction failing | ✅ Fixed | Simplified logic with fallbacks |
| Silent failures | ✅ Fixed | Comprehensive error handling |
| TPS calculation errors | ✅ Fixed | Division by zero protection |
| Database crashes | ✅ Fixed | All queries error-protected |
| Session ID inconsistency | ✅ Fixed | Unified extraction logic |
| Memory leaks | ✅ Fixed | Batch flush improvements |
| Missing validation | ✅ Fixed | Validation in recordRequest |
| Poor logging | ✅ Fixed | Consistent prefixes added |

## 📝 Logging

### Log Prefixes
- `[METRICS-MIDDLEWARE]` - Request initialization
- `[COLLECT-RESPONSE]` - Response processing and token extraction
- `[METRICS]` - Core metrics operations
- `[METRICS-DB]` - Database operations

### Important Logs to Monitor
```bash
# Token extraction
[COLLECT-RESPONSE] Tokens from cache: input=X, output=Y

# Metrics recording
[COLLECT-RESPONSE] Recording metrics: {...}

# Batch flushing
[METRICS] Successfully flushed N metrics to database

# Errors (should be rare)
[COLLECT-RESPONSE] Extract error: ...
[METRICS-DB] Error in batch insert transaction: ...
```

## 💾 Database

### Location
```
~/.claude-code-router/data/metrics.db
```

### Tables
- `requests` - Individual request records
- `aggregated_hourly` - Pre-aggregated hourly data
- `provider_health` - Circuit breaker tracking

### Maintenance
- Automatic cleanup: Every hour
- Retention: 90 days (configurable)
- Manual cleanup: Available via API

## 🎨 Metrics Dashboard

The UI dashboard at `http://localhost:3456/` displays:
- Real-time TPS and RPM
- Active sessions
- Error rates
- Provider performance
- Cost analytics
- Token usage trends

## 🧪 Testing

### Quick Test
```bash
# 1. Start server
npm start

# 2. Check metrics are working
curl http://localhost:3456/api/metrics/realtime | jq

# 3. Make a test request
curl -X POST http://localhost:3456/v1/messages \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic,claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"test"}],"max_tokens":50}'

# 4. Verify tokens tracked
curl http://localhost:3456/api/metrics/realtime | jq '.totalInputTokens, .totalOutputTokens'
```

## 🚨 Troubleshooting

### No Tokens Tracked
1. Check logs for `[COLLECT-RESPONSE]` messages
2. Verify session cache is populated
3. Check response data availability

### High Error Rate
1. Check `/api/metrics/realtime` for error breakdown
2. Look at `statusCodeDistribution` for error types
3. Review provider health

### Database Issues
1. Check disk space
2. Verify permissions on data directory
3. Use `/api/metrics/database-stats` for health check

### Performance Issues
1. Check batch flush is working (logs)
2. Monitor database size
3. Review cleanup schedule

## 📈 Best Practices

1. **Monitor error rates** - Keep below 5%
2. **Check logs regularly** - Look for patterns
3. **Flush before shutdown** - Use `/api/metrics/flush`
4. **Set up alerts** - For error spikes or high latency
5. **Review costs** - Use cost analytics endpoint

## 🔗 Related Files

- `METRICS_FIX_SUMMARY.md` - Detailed fix documentation
- `METRICS_UPGRADE_CHECKLIST.md` - Deployment checklist
- `src/middleware/metrics.ts` - Request/response tracking
- `src/utils/metrics.ts` - Core metrics logic
- `src/utils/metricsDatabase.ts` - Persistence layer

## 📞 Support

Issues? Check:
1. Logs with `[METRICS]` prefix
2. Database stats endpoint
3. Real-time metrics for patterns
4. This guide for common solutions
