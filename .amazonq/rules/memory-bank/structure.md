# Project Structure

## Directory Organization

### Root Structure
```
claude-code-router/
├── src/                    # Core TypeScript source code
├── ui/                     # React-based web dashboard
├── docs/                   # Comprehensive documentation
├── examples/               # Example scripts and configurations
├── scripts/                # Build and utility scripts
├── test/                   # Test suites
├── guides/                 # Configuration examples
└── config files            # Various configuration examples
```

## Core Components

### `/src` - Main Application Source

#### Entry Points
- **cli.ts**: Command-line interface entry point, handles all `ccr` commands
- **index.ts**: Main application entry, initializes server and services
- **server.ts**: Core Fastify server setup, request handling, and routing logic
- **constants.ts**: Application-wide constants and configuration defaults

#### Specialized Server Endpoints
- **server.apiKeyPool.endpoints.ts**: API endpoints for API key pool management
- **server.httpConnectionPool.endpoints.ts**: Endpoints for connection pool monitoring
- **server.shinMode.endpoints.ts**: Endpoints for Shin Mode (advanced routing) features

#### `/src/agents` - Built-in Agents
- **image.agent.ts**: Handles image-related tasks and transformations
- **type.ts**: Type definitions for agents
- **index.ts**: Agent registry and exports

#### `/src/config` - Configuration Loaders
- **apiKeyPool.config.ts**: API key pool configuration loader
- **cache.config.ts**: Cache system configuration
- **httpConnectionPool.config.ts**: Connection pool settings
- **shinMode.config.ts**: Shin Mode configuration

#### `/src/middleware` - Request Processing Middleware
- **apiKeyPool.ts**: API key selection and rotation logic
- **auth.ts**: Authentication and authorization
- **cache.ts**: Cache lookup and storage
- **metrics.ts**: Request metrics collection
- **shinMode.ts**: Advanced routing and model selection

#### `/src/utils` - Utility Modules

**Core Utilities:**
- **router.ts**: Main routing logic for model selection
- **modelSelector.ts**: Model selection algorithms
- **providerStrategies.ts**: Provider-specific handling strategies

**Performance & Reliability:**
- **apiKeyPool.ts**: API key pool management and health monitoring
- **httpConnectionPool.ts**: HTTP connection pooling implementation
- **sessionConnectionPool.ts**: Session-based connection management
- **cache.ts**: Multi-layer caching implementation
- **requestCache.ts**: Request-level caching
- **circuitBreaker.ts**: Circuit breaker pattern for fault tolerance
- **advancedRateLimiter.ts**: Token bucket rate limiting
- **smartRetry.ts**: Retry logic with exponential backoff

**Monitoring & Metrics:**
- **metrics.ts**: Metrics collection and aggregation
- **metricsDatabase.ts**: SQLite-based metrics storage
- **prometheus.ts**: Prometheus metrics exporter
- **universalTokenExtractor.ts**: Token usage tracking across providers
- **realTimeTokenTracker.ts**: Real-time token counting
- **systemHealth.ts**: System health monitoring
- **alerting.ts**: Alert generation and notification

**Stream Processing:**
- **rewriteStream.ts**: Stream transformation utilities
- **SSEParser.transform.ts**: Server-Sent Events parser
- **SSESerializer.transform.ts**: Server-Sent Events serializer

**CLI & UI:**
- **codeCommand.ts**: Claude Code command execution
- **statusline.ts**: Terminal status line rendering
- **status.ts**: Status information collection

**Utilities:**
- **auth.ts**: Authentication utilities
- **connectionManager.ts**: Connection lifecycle management
- **sessionAffinity.ts**: Session affinity for stateful connections
- **shinMode.ts**: Shin Mode utilities
- **logCleanup.ts**: Log file rotation and cleanup
- **processCheck.ts**: Process management utilities
- **close.ts**: Graceful shutdown handling
- **update.ts**: Auto-update functionality
- **index.ts**: Utility exports

### `/ui` - Web Dashboard

#### Structure
```
ui/
├── src/
│   ├── components/         # React components
│   ├── lib/               # Utility libraries
│   ├── locales/           # i18n translations
│   ├── styles/            # CSS styles
│   ├── utils/             # Helper functions
│   ├── App.tsx            # Main application component
│   ├── routes.tsx         # Route definitions
│   ├── i18n.ts            # Internationalization setup
│   └── types.ts           # TypeScript type definitions
├── public/                # Static assets
└── config files           # Vite, TypeScript, ESLint configs
```

**Key Features:**
- Monaco Editor integration for JSON editing
- Radix UI components for accessible UI
- React Router for navigation
- i18next for internationalization
- Tailwind CSS for styling
- Vite for fast development and building

### `/docs` - Documentation

#### Organization
```
docs/
├── guides/                # Step-by-step tutorials
├── features/              # Feature descriptions
├── implementation/        # Technical implementation details
├── summaries/             # Bug fixes and enhancement reports
├── blog/                  # Technical articles (en/zh)
├── ui/                    # UI documentation
├── api/                   # API documentation
└── architecture/          # Architecture diagrams and docs
```

**Documentation Categories:**
- **Guides**: Quick start, API key pool, cache system, Shin Mode, HTTP connection pool
- **Features**: Dashboard, universal tracking, cache, performance proposals
- **Implementation**: Complete implementation reports for major features
- **Summaries**: Bug fixes, enhancements, metrics reports
- **Blog**: Project motivation, router capabilities, technical insights

### `/examples` - Example Code
- **cache_benchmark.js**: Cache performance benchmarking
- **cache_test.sh**: Cache functionality testing

### `/test` - Test Suites
```
test/
├── integration/           # Integration tests
└── utils/                 # Test utilities
```

## Architectural Patterns

### Layered Architecture
1. **Entry Layer**: CLI and server initialization
2. **Middleware Layer**: Authentication, caching, metrics, routing
3. **Core Logic Layer**: Router, model selector, provider strategies
4. **Utility Layer**: Reusable utilities and helpers
5. **Storage Layer**: Metrics database, cache storage

### Request Flow
```
Client Request
    ↓
Authentication Middleware
    ↓
Cache Middleware (lookup)
    ↓
Metrics Middleware (start tracking)
    ↓
API Key Pool Middleware (select key)
    ↓
Shin Mode Middleware (advanced routing)
    ↓
Router (model selection)
    ↓
Provider Strategy (request transformation)
    ↓
HTTP Connection Pool (execute request)
    ↓
Response Transformation
    ↓
Cache Middleware (store)
    ↓
Metrics Middleware (record)
    ↓
Client Response
```

### Plugin System
- **Transformers**: Modular request/response transformers
- **Custom Routers**: JavaScript modules for custom routing logic
- **Agents**: Extensible agent system for specialized tasks

### Configuration Management
- **JSON5 Support**: Comments and trailing commas in config files
- **Environment Variables**: Secure credential management
- **Multiple Config Files**: Separate configs for different features
- **Example Configs**: Comprehensive examples for all features

## Key Relationships

### Server ↔ Middleware
Server registers middleware in specific order to ensure proper request processing pipeline

### Router ↔ Provider Strategies
Router selects model, provider strategies handle API-specific transformations

### Cache ↔ Metrics
Cache operations are tracked in metrics for monitoring cache effectiveness

### API Key Pool ↔ Circuit Breaker
API key health is monitored by circuit breaker to prevent cascading failures

### Connection Pool ↔ Session Affinity
Connection pool maintains session affinity for stateful interactions

### UI ↔ Server
UI communicates with server via REST API for configuration management and monitoring
