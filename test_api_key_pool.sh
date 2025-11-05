#!/bin/bash

# API Key Pool System Test Script
# Tests all major functionality of the API key pool

echo "========================================"
echo "API Key Pool System Test"
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
test_endpoint "Pool Statistics" "$BASE_URL/api/apikeys/stats"
test_endpoint "Pool Health Status" "$BASE_URL/api/apikeys/health" GET "" show

echo ""
echo "2. Strategy Management"
echo "----------------------"

test_endpoint "Get Current Strategy" "$BASE_URL/api/apikeys/strategy"
test_endpoint "Change to Round-Robin" "$BASE_URL/api/apikeys/strategy" POST '{"strategy":"round-robin"}'
test_endpoint "Change to Least-Loaded" "$BASE_URL/api/apikeys/strategy" POST '{"strategy":"least-loaded"}'
test_endpoint "Change to LRU" "$BASE_URL/api/apikeys/strategy" POST '{"strategy":"lru"}'
test_endpoint "Change to Weighted" "$BASE_URL/api/apikeys/strategy" POST '{"strategy":"weighted"}'

echo ""
echo "3. Distribution & Metrics"
echo "-------------------------"

test_endpoint "Get Distribution" "$BASE_URL/api/apikeys/distribution"
test_endpoint "Force Health Check" "$BASE_URL/api/apikeys/health-check" POST "{}"

echo ""
echo "4. Make Test Requests"
echo "---------------------"

if [ "$AUTH_KEY" != "your-auth-key-here" ]; then
    echo "Making 5 test requests to trigger key rotation..."
    for i in {1..5}; do
        echo -n "Request $i... "
        response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/v1/messages" \
            -H "x-api-key: $AUTH_KEY" \
            -H "Content-Type: application/json" \
            -d '{
                "model": "anthropic,claude-3-5-sonnet-20241022",
                "messages": [{"role": "user", "content": "Say hello in 3 words"}],
                "max_tokens": 50
            }')
        
        http_code=$(echo "$response" | tail -n1)
        if [ "$http_code" = "200" ]; then
            echo -e "${GREEN}OK${NC}"
        else
            echo -e "${RED}FAILED${NC} (HTTP $http_code)"
        fi
        sleep 1
    done
    
    echo ""
    echo "Checking distribution after requests..."
    test_endpoint "Updated Distribution" "$BASE_URL/api/apikeys/distribution" GET "" show
else
    echo -e "${YELLOW}Skipping request tests (AUTH_KEY not configured)${NC}"
    echo "To test with real requests, edit this script and set AUTH_KEY"
fi

echo ""
echo "5. Provider Details"
echo "-------------------"

# Try to get details for common providers
for provider in anthropic openai google; do
    test_endpoint "Provider: $provider" "$BASE_URL/api/apikeys/provider/$provider"
done

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
    echo "✅ API Key Pool system is working correctly"
    echo ""
    echo "Next steps:"
    echo "1. Add your actual API keys to config.json"
    echo "2. Set AUTH_KEY in this script to test with real requests"
    echo "3. Monitor with: watch -n 2 'curl -s http://localhost:3456/api/apikeys/stats | jq'"
    echo "4. Check distribution: curl http://localhost:3456/api/apikeys/distribution | jq"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "1. Make sure the server is running: npm start"
    echo "2. Check that ApiKeyPool is enabled in config.json"
    echo "3. Verify you have keys configured for at least one provider"
    echo "4. Check server logs for errors"
    exit 1
fi
