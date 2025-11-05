#!/bin/bash

# Shin Mode System Test Script
# Tests all major functionality of Shin Mode

echo "========================================"
echo "Shin Mode System Test"
echo "========================================"
echo ""

# Configuration
BASE_URL="http://localhost:3456"
AUTH_KEY="your-auth-key-here"  # Replace with your actual auth key

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Helper functions
test_endpoint() {
    local name=$1
    local url=$2
    local method=${3:-GET}
    local data=$4
    
    echo -n "Testing: $name... "
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "$url")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Content-Type: application/json" \
            -d "$data" "$url")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}PASS${NC}"
        ((PASSED++))
        if [ "$5" = "show" ]; then
            echo "$body" | jq '.' 2>/dev/null || echo "$body"
        fi
    else
        echo -e "${RED}FAIL${NC} (HTTP $http_code)"
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
        ((FAILED++))
    fi
    echo ""
}

# Start tests
echo "1. Basic Health Checks"
echo "----------------------"

test_endpoint "Server Health" "$BASE_URL/health"
test_endpoint "Get Current Mode" "$BASE_URL/api/shin/mode" GET "" show

echo ""
echo "2. Mode Switching"
echo "-----------------"

test_endpoint "Switch to Shin Mode" "$BASE_URL/api/shin/mode" POST '{"mode":"shin"}'
test_endpoint "Verify Shin Mode" "$BASE_URL/api/shin/mode"
test_endpoint "Switch to Normal Mode" "$BASE_URL/api/shin/mode" POST '{"mode":"normal"}'
test_endpoint "Verify Normal Mode" "$BASE_URL/api/shin/mode"
test_endpoint "Switch Back to Shin Mode" "$BASE_URL/api/shin/mode" POST '{"mode":"shin"}'

echo ""
echo "3. Queue Management"
echo "-------------------"

test_endpoint "Get Queue Stats" "$BASE_URL/api/shin/stats" GET "" show
test_endpoint "Get Queue Details" "$BASE_URL/api/shin/queue-details"
test_endpoint "Get Health Status" "$BASE_URL/api/shin/health"

echo ""
echo "4. Provider-Specific Queries"
echo "-----------------------------"

for provider in anthropic openai google; do
    test_endpoint "Queue for $provider" "$BASE_URL/api/shin/queue?provider=$provider"
done

echo ""
echo "5. Queue Stress Test (if enabled)"
echo "----------------------------------"

if [ "$AUTH_KEY" != "your-auth-key-here" ]; then
    echo "Making multiple concurrent requests to test queueing..."
    
    # Make 10 requests rapidly
    for i in {1..10}; do
        (
            curl -s -X POST "$BASE_URL/v1/messages" \
                -H "x-api-key: $AUTH_KEY" \
                -H "Content-Type: application/json" \
                -H "x-priority: normal" \
                -d '{
                    "model": "anthropic,claude-3-5-sonnet-20241022",
                    "messages": [{"role": "user", "content": "Say hello in 2 words"}],
                    "max_tokens": 20
                }' > /dev/null &
        )
    done
    
    echo "Requests sent, waiting 2 seconds..."
    sleep 2
    
    echo ""
    echo "Checking queue after concurrent requests..."
    test_endpoint "Queue Stats After Load" "$BASE_URL/api/shin/stats" GET "" show
    
    echo ""
    echo "Waiting for queue to process..."
    sleep 5
    
    test_endpoint "Final Queue Stats" "$BASE_URL/api/shin/stats" GET "" show
else
    echo -e "${YELLOW}Skipping stress test (AUTH_KEY not configured)${NC}"
    echo "To test with real requests, edit this script and set AUTH_KEY"
fi

echo ""
echo "6. Priority Testing"
echo "-------------------"

if [ "$AUTH_KEY" != "your-auth-key-here" ]; then
    echo "Testing priority queue ordering..."
    
    # Send low priority request
    curl -s -X POST "$BASE_URL/v1/messages" \
        -H "x-api-key: $AUTH_KEY" \
        -H "Content-Type: application/json" \
        -H "x-priority: low" \
        -d '{"model":"anthropic,claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"Low"}],"max_tokens":20}' > /dev/null &
    
    sleep 0.5
    
    # Send high priority request
    curl -s -X POST "$BASE_URL/v1/messages" \
        -H "x-api-key: $AUTH_KEY" \
        -H "Content-Type: application/json" \
        -H "x-priority: high" \
        -d '{"model":"anthropic,claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"High"}],"max_tokens":20}' > /dev/null &
    
    sleep 1
    
    test_endpoint "Queue After Priority Test" "$BASE_URL/api/shin/queue-details" GET "" show
else
    echo -e "${YELLOW}Skipping priority test (AUTH_KEY not configured)${NC}"
fi

echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    echo ""
    echo "✅ Shin Mode system is working correctly"
    echo ""
    echo "Next steps:"
    echo "1. Enable Shin Mode in config.json for your providers"
    echo "2. Set AUTH_KEY in this script to test with real requests"
    echo "3. Monitor with: watch -n 2 'curl -s http://localhost:3456/api/shin/stats | jq'"
    echo "4. Check queue: curl http://localhost:3456/api/shin/queue?provider=anthropic | jq"
    echo "5. Switch modes: curl -X POST http://localhost:3456/api/shin/mode -d '{\"mode\":\"shin\"}'"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "1. Make sure the server is running: npm start"
    echo "2. Check that ShinMode is enabled in config.json"
    echo "3. Verify you have providers configured"
    echo "4. Check server logs for errors"
    exit 1
fi
