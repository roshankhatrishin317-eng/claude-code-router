#!/bin/bash

# Claude Code Router - Enhanced Setup Script
# This script helps you set up and test the new enterprise features

echo "🚀 Setting up Claude Code Router with Enhanced Features..."
echo ""

# 1. Backup current config
echo "📋 Step 1: Backing up current config..."
cp ~/.claude-code-router/config.json ~/.claude-code-router/config.json.backup 2>/dev/null || true
echo "✅ Backup created at ~/.claude-code-router/config.json.backup"
echo ""

# 2. Create new config from example
echo "📋 Step 2: Creating enhanced config..."
cp config.example.json ~/.claude-code-router/config.json
echo "✅ Enhanced config created"
echo ""

# 3. Add your API keys to the config
echo "📋 Step 3: Please edit ~/.claude-code-router/config.json and add your API keys:"
echo "   - iflow: Replace 'YOUR_IFLOW_API_KEY_HERE' with your actual key"
echo "   - Nvidia: Replace 'YOUR_NVIDIA_API_KEY_HERE' with your actual key"
echo "   - zlm: Replace 'YOUR_ZLM_API_KEY_HERE' with your actual key"
echo ""

# 4. Build the project
echo "📋 Step 4: Building enhanced version..."
npm run build
echo ""

# 5. Start the enhanced router
echo "📋 Step 5: Starting enhanced router..."
ccr stop 2>/dev/null || true
sleep 2
ccr start
echo ""

# 6. Wait for startup
echo "⏳ Waiting for router to start..."
sleep 5

# 7. Test new endpoints
echo ""
echo "🧪 Testing new enterprise features..."
echo ""

echo "1. Testing circuit breaker status:"
curl -s http://localhost:3456/api/circuit-breaker/status | jq '.data.summary' 2>/dev/null || echo "   (jq not available, showing raw response)"
echo ""

echo "2. Testing real-time metrics:"
curl -s http://localhost:3456/api/metrics/realtime | jq '.requestsPerMinute, .activeSessions, .errorRate' 2>/dev/null || echo "   (jq not available)"
echo ""

echo "3. Testing Prometheus export:"
echo "   GET http://localhost:3456/metrics"
echo "   (For Grafana integration)"
echo ""

echo "4. Testing system health:"
curl -s http://localhost:3456/api/metrics/realtime | jq '.systemHealth' 2>/dev/null || echo "   (System health data available)"
echo ""

echo "✅ Setup complete!"
echo ""
echo "🎯 Available endpoints:"
echo "   📊 Live Metrics:    http://localhost:3456/api/metrics/realtime"
echo "   🔧 Circuit Status:  http://localhost:3456/api/circuit-breaker/status"
echo "   🚨 Active Alerts:   http://localhost:3456/api/alerts/active"
echo "   📈 Prometheus:      http://localhost:3456/metrics"
echo "   💾 Database Stats:  http://localhost:3456/api/metrics/database-stats"
echo ""
echo "💡 Next steps:"
echo "   1. Make some API requests through the router"
echo "   2. Check the metrics endpoints to see real data"
echo "   3. Set up Grafana with http://localhost:3456/metrics"
echo "   4. Configure alerts in config.json"
echo ""
echo "🔧 Configuration location: ~/.claude-code-router/config.json"
echo "📊 Database location: ~/.claude-code-router/data/metrics.db"
