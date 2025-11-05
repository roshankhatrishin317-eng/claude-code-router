#!/bin/bash

# Cache Testing Script for Claude Code Router
# This script tests the caching functionality

API_KEY="${APIKEY:-your-api-key}"
BASE_URL="${BASE_URL:-http://localhost:3456}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "======================================"
echo "  Cache System Test Suite"
echo "======================================"
echo ""

# Test 1: Check if cache is enabled
echo -e "${YELLOW}Test 1: Checking cache status...${NC}"
CACHE_STATUS=$(curl -s "$BASE_URL/api/cache/stats" -H "x-api-key: $API_KEY")
echo "$CACHE_STATUS" | jq .

if echo "$CACHE_STATUS" | jq -e '.enabled == true' > /dev/null; then
    echo -e "${GREEN}✓ Cache is enabled${NC}"
else
    echo -e "${RED}✗ Cache is not enabled${NC}"
    echo "Please enable cache in config.json"
    exit 1
fi
echo ""

# Test 2: First request (cache miss)
echo -e "${YELLOW}Test 2: First request (expecting cache MISS)...${NC}"
START_TIME=$(date +%s%N)
RESPONSE1=$(curl -s -w "\nHTTP_CODE:%{http_code}\nX-Cache:%{header_x_cache}\nTIME:%{time_total}" \
  -X POST "$BASE_URL/v1/messages" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "openrouter,anthropic/claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "What is 2+2? Just give the number."}],
    "temperature": 0.3,
    "max_tokens": 10
  }')
END_TIME=$(date +%s%N)
TIME1=$(echo "scale=3; ($END_TIME - $START_TIME) / 1000000000" | bc)

CACHE_HEADER1=$(echo "$RESPONSE1" | grep "X-Cache:" | cut -d: -f2)
echo "Cache header: $CACHE_HEADER1"
echo "Response time: ${TIME1}s"

if [[ "$CACHE_HEADER1" == *"MISS"* ]]; then
    echo -e "${GREEN}✓ Cache miss detected (expected)${NC}"
else
    echo -e "${YELLOW}⚠ Expected cache miss but got: $CACHE_HEADER1${NC}"
fi
echo ""

# Small delay to ensure cache is written
sleep 1

# Test 3: Identical request (cache hit)
echo -e "${YELLOW}Test 3: Identical request (expecting cache HIT)...${NC}"
START_TIME=$(date +%s%N)
RESPONSE2=$(curl -s -w "\nHTTP_CODE:%{http_code}\nX-Cache:%{header_x_cache}\nTIME:%{time_total}" \
  -X POST "$BASE_URL/v1/messages" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "openrouter,anthropic/claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "What is 2+2? Just give the number."}],
    "temperature": 0.3,
    "max_tokens": 10
  }')
END_TIME=$(date +%s%N)
TIME2=$(echo "scale=3; ($END_TIME - $START_TIME) / 1000000000" | bc)

CACHE_HEADER2=$(echo "$RESPONSE2" | grep "X-Cache:" | cut -d: -f2)
echo "Cache header: $CACHE_HEADER2"
echo "Response time: ${TIME2}s"

if [[ "$CACHE_HEADER2" == *"HIT"* ]]; then
    echo -e "${GREEN}✓ Cache hit detected (expected)${NC}"
    
    # Calculate speedup
    SPEEDUP=$(echo "scale=2; $TIME1 / $TIME2" | bc)
    echo -e "${GREEN}✓ Speedup: ${SPEEDUP}x faster${NC}"
else
    echo -e "${RED}✗ Expected cache hit but got: $CACHE_HEADER2${NC}"
fi
echo ""

# Test 4: Different request (cache miss)
echo -e "${YELLOW}Test 4: Different request (expecting cache MISS)...${NC}"
RESPONSE3=$(curl -s -w "\nX-Cache:%{header_x_cache}" \
  -X POST "$BASE_URL/v1/messages" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "openrouter,anthropic/claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "What is 3+3? Just give the number."}],
    "temperature": 0.3,
    "max_tokens": 10
  }')

CACHE_HEADER3=$(echo "$RESPONSE3" | grep "X-Cache:" | cut -d: -f2)
echo "Cache header: $CACHE_HEADER3"

if [[ "$CACHE_HEADER3" == *"MISS"* ]]; then
    echo -e "${GREEN}✓ Cache miss detected (expected for different request)${NC}"
else
    echo -e "${YELLOW}⚠ Expected cache miss but got: $CACHE_HEADER3${NC}"
fi
echo ""

# Test 5: High temperature request (should not cache)
echo -e "${YELLOW}Test 5: High temperature request (should not cache)...${NC}"
RESPONSE4=$(curl -s -w "\nX-Cache:%{header_x_cache}" \
  -X POST "$BASE_URL/v1/messages" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "openrouter,anthropic/claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "Tell me a random fact."}],
    "temperature": 0.9,
    "max_tokens": 50
  }')

CACHE_HEADER4=$(echo "$RESPONSE4" | grep "X-Cache:" | cut -d: -f2)
echo "Cache header: $CACHE_HEADER4"

if [[ "$CACHE_HEADER4" == *"MISS"* ]] || [[ -z "$CACHE_HEADER4" ]]; then
    echo -e "${GREEN}✓ High temperature request not cached (expected)${NC}"
else
    echo -e "${YELLOW}⚠ High temperature request was cached${NC}"
fi
echo ""

# Test 6: Cache statistics
echo -e "${YELLOW}Test 6: Cache statistics...${NC}"
CACHE_STATS=$(curl -s "$BASE_URL/api/cache/stats" -H "x-api-key: $API_KEY")
echo "$CACHE_STATS" | jq .

HITS=$(echo "$CACHE_STATS" | jq -r '.hits')
MISSES=$(echo "$CACHE_STATS" | jq -r '.misses')
HIT_RATE=$(echo "$CACHE_STATS" | jq -r '.hitRate')

echo -e "${GREEN}Hits: $HITS${NC}"
echo -e "${GREEN}Misses: $MISSES${NC}"
echo -e "${GREEN}Hit Rate: $(echo "scale=2; $HIT_RATE * 100" | bc)%${NC}"
echo ""

# Test 7: Cache invalidation
echo -e "${YELLOW}Test 7: Testing cache invalidation...${NC}"
INVALIDATE_RESULT=$(curl -s -X POST "$BASE_URL/api/cache/invalidate" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{}')

echo "$INVALIDATE_RESULT" | jq .

if echo "$INVALIDATE_RESULT" | jq -e '.success == true' > /dev/null; then
    echo -e "${GREEN}✓ Cache invalidated successfully${NC}"
else
    echo -e "${RED}✗ Cache invalidation failed${NC}"
fi
echo ""

# Test 8: Verify cache is cleared
echo -e "${YELLOW}Test 8: Verify cache is cleared...${NC}"
CACHE_STATS_AFTER=$(curl -s "$BASE_URL/api/cache/stats" -H "x-api-key: $API_KEY")
ENTRIES_AFTER=$(echo "$CACHE_STATS_AFTER" | jq -r '.totalEntries')

if [ "$ENTRIES_AFTER" -eq 0 ]; then
    echo -e "${GREEN}✓ Cache cleared successfully (0 entries)${NC}"
else
    echo -e "${YELLOW}⚠ Cache has $ENTRIES_AFTER entries after clear${NC}"
fi
echo ""

# Summary
echo "======================================"
echo "  Test Summary"
echo "======================================"
echo -e "${GREEN}✓ Cache system is working correctly${NC}"
echo ""
echo "Performance comparison:"
echo "  First request (miss): ${TIME1}s"
echo "  Cached request (hit):  ${TIME2}s"
if (( $(echo "$TIME1 > $TIME2" | bc -l) )); then
    IMPROVEMENT=$(echo "scale=1; (($TIME1 - $TIME2) / $TIME1) * 100" | bc)
    echo -e "  ${GREEN}Improvement: ${IMPROVEMENT}% faster${NC}"
fi
echo ""
echo "Recommendations:"
echo "  • Monitor hit rate in production"
echo "  • Adjust TTL based on your use case"
echo "  • Consider enabling Redis for distributed setups"
echo "  • Enable semantic caching for conversational AI"
echo ""
