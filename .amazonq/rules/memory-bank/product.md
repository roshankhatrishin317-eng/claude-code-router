# Product Overview

## Purpose
Claude Code Router is a flexible routing proxy that enables users to run Claude Code with alternative LLM providers and models, eliminating the need for an Anthropic account. It acts as an intelligent middleware layer between Claude Code and various LLM APIs, providing advanced routing, caching, and transformation capabilities.

## Value Proposition
- **Cost Optimization**: Route background tasks to cheaper or local models while using premium models for complex reasoning
- **Provider Flexibility**: Switch between multiple LLM providers (OpenRouter, DeepSeek, Ollama, Gemini, etc.) without changing Claude Code
- **Performance Enhancement**: Multi-layer caching system reduces API costs by 40-60% and improves response times by 30-50%
- **Enterprise Features**: API key pooling, connection pooling, circuit breakers, rate limiting, and comprehensive metrics
- **Customization**: Transform requests/responses to ensure compatibility across different provider APIs

## Key Features

### Core Capabilities
- **Intelligent Model Routing**: Route requests to different models based on context (background tasks, reasoning, long context, web search, image processing)
- **Multi-Provider Support**: Supports 15+ providers including OpenRouter, DeepSeek, Ollama, Gemini, Volcengine, SiliconFlow, ModelScope, DashScope
- **Dynamic Model Switching**: Change models on-the-fly using `/model provider,model` command within Claude Code
- **Custom Router Logic**: Implement advanced routing rules via JavaScript modules
- **Subagent Routing**: Direct specific subagent tasks to designated models

### Performance & Reliability
- **Multi-Layer Caching**: Memory, Redis, and disk-based caching with semantic similarity matching
- **API Key Pool**: Distribute requests across multiple API keys with health monitoring and automatic failover
- **HTTP Connection Pool**: Reuse connections for improved performance and reduced latency
- **Circuit Breaker**: Automatic failure detection and recovery
- **Advanced Rate Limiting**: Token bucket algorithm with per-provider limits
- **Smart Retry**: Exponential backoff with jitter for failed requests

### Developer Experience
- **CLI Management**: Interactive terminal interface for model and provider configuration (`ccr model`)
- **Web Dashboard**: Visual UI for configuration management (`ccr ui`)
- **Status Line**: Real-time monitoring of router status in the terminal
- **Comprehensive Logging**: Dual logging system (server-level and application-level)
- **Environment Variable Support**: Secure API key management via environment variable interpolation

### Enterprise & Integration
- **GitHub Actions Integration**: Run Claude Code tasks in CI/CD pipelines
- **Authentication**: Optional API key authentication for secure deployments
- **Metrics & Monitoring**: Built-in metrics database with Prometheus support
- **Docker Support**: Containerized deployment with docker-compose
- **Non-Interactive Mode**: Compatibility with automated environments

### Extensibility
- **Plugin System**: Custom transformers for request/response modification
- **Built-in Transformers**: 15+ pre-built transformers (deepseek, gemini, openrouter, reasoning, tooluse, etc.)
- **Image Agent**: Built-in agent for handling image-related tasks
- **Universal Token Tracking**: Track token usage across all providers

## Target Users

### Individual Developers
- Developers wanting to use Claude Code without Anthropic subscription
- Users seeking cost optimization through model routing
- Developers experimenting with different LLM providers

### Teams & Organizations
- Development teams requiring centralized LLM access management
- Organizations needing cost control and usage monitoring
- Teams building multi-model AI workflows

### Enterprise Users
- Companies requiring high availability and fault tolerance
- Organizations with compliance needs for API key management
- Enterprises needing detailed metrics and monitoring

## Use Cases

1. **Cost-Effective Development**: Use expensive models only for complex tasks, route simple tasks to cheaper alternatives
2. **Multi-Model Workflows**: Leverage strengths of different models (reasoning, long context, web search) in a single session
3. **Local Development**: Route to local Ollama models for offline development
4. **CI/CD Integration**: Automate code reviews and tasks in GitHub Actions
5. **Provider Migration**: Easily switch providers without changing client code
6. **Load Distribution**: Distribute requests across multiple API keys to avoid rate limits
7. **Caching Strategy**: Reduce API costs for repeated or similar queries
8. **Experimentation**: Test and compare different models and providers seamlessly
