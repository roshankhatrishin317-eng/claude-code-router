# Technology Stack

## Programming Languages

### TypeScript (Primary)
- **Version**: 5.8.2
- **Target**: ES2022
- **Module System**: CommonJS
- **Strict Mode**: Enabled
- **Usage**: All backend code, CLI, and core logic

### JavaScript
- **Usage**: Custom transformers, router plugins, build scripts
- **Module System**: CommonJS for Node.js compatibility

### React/TypeScript (UI)
- **React Version**: 19.1.0
- **TypeScript Version**: ~5.8.3
- **Module Type**: ESM (ES Modules)

## Core Dependencies

### Backend Framework
- **fastify**: ^5.4.0 - High-performance web framework
- **@fastify/static**: ^8.2.0 - Static file serving
- **@fastify/jwt**: ^9.0.2 - JWT authentication

### LLM Integration
- **@musistudio/llms**: ^1.0.39 - Custom LLM provider abstraction library

### Database & Storage
- **better-sqlite3**: ^11.7.0 - SQLite database for metrics storage
- **lru-cache**: ^11.2.2 - In-memory LRU cache implementation

### CLI & User Interaction
- **@inquirer/prompts**: ^5.0.0 - Interactive command-line prompts
- **minimist**: ^1.2.8 - Command-line argument parsing
- **openurl**: ^1.1.1 - Cross-platform URL opening

### Utilities
- **dotenv**: ^16.4.7 - Environment variable management
- **json5**: ^2.2.3 - JSON with comments support
- **jsonwebtoken**: ^9.0.2 - JWT token generation and verification
- **tiktoken**: ^1.0.21 - Token counting for various models
- **uuid**: ^11.1.0 - UUID generation
- **shell-quote**: ^1.8.3 - Shell command escaping
- **find-process**: ^2.0.0 - Process management
- **rotating-file-stream**: ^3.2.7 - Log file rotation

## Frontend Stack

### UI Framework
- **react**: ^19.1.0 - UI library
- **react-dom**: ^19.1.0 - React DOM rendering
- **react-router-dom**: ^7.7.0 - Client-side routing

### UI Components
- **@radix-ui/react-***: Multiple Radix UI primitives for accessible components
  - dialog, label, popover, slot, switch, tabs, tooltip
- **lucide-react**: ^0.525.0 - Icon library
- **cmdk**: ^1.1.1 - Command palette component

### Code Editor
- **@monaco-editor/react**: ^4.7.0 - Monaco editor integration for JSON editing

### Styling
- **@tailwindcss/vite**: ^4.1.11 - Tailwind CSS v4 with Vite
- **tailwindcss**: ^4.1.11 - Utility-first CSS framework
- **tailwindcss-animate**: ^1.0.7 - Animation utilities
- **tailwind-merge**: ^3.3.1 - Merge Tailwind classes
- **class-variance-authority**: ^0.7.1 - Component variant management
- **clsx**: ^2.1.1 - Conditional class names

### Internationalization
- **i18next**: ^25.3.2 - i18n framework
- **react-i18next**: ^15.6.1 - React bindings for i18next
- **i18next-browser-languagedetector**: ^8.2.0 - Language detection

### Drag & Drop
- **react-dnd**: ^16.0.1 - Drag and drop library
- **react-dnd-html5-backend**: ^16.0.1 - HTML5 backend for react-dnd

### Color Picker
- **react-colorful**: ^5.6.1 - Color picker component

## Build Tools

### Backend Build
- **esbuild**: ^0.25.1 - Fast JavaScript bundler and minifier
- **Custom Build Script**: scripts/build.js - Custom build orchestration

### Frontend Build
- **vite**: ^7.0.4 - Next-generation frontend build tool
- **@vitejs/plugin-react**: ^4.6.0 - React plugin for Vite
- **vite-plugin-singlefile**: ^2.3.0 - Bundle to single HTML file

### TypeScript Compilation
- **typescript**: ^5.8.2 (backend), ~5.8.3 (frontend)
- **Source Maps**: Enabled for debugging
- **Declaration Files**: Generated for library usage

## Development Tools

### Code Quality
- **eslint**: ^9.30.1 - JavaScript/TypeScript linting
- **@eslint/js**: ^9.30.1 - ESLint JavaScript rules
- **typescript-eslint**: ^8.35.1 - TypeScript ESLint rules
- **eslint-plugin-react-hooks**: ^5.2.0 - React hooks linting
- **eslint-plugin-react-refresh**: ^0.4.20 - React refresh linting

### CSS Processing
- **postcss**: ^8.5.6 - CSS transformation
- **autoprefixer**: ^10.4.21 - Automatic vendor prefixing
- **@tailwindcss/postcss**: ^4.1.11 - Tailwind PostCSS plugin

### Utilities
- **shx**: ^0.4.0 - Cross-platform shell commands
- **globals**: ^16.3.0 - Global variables for ESLint

## Runtime Environment

### Node.js
- **Minimum Version**: Node.js 16+ (implied by dependencies)
- **Recommended**: Node.js 18+ for optimal performance
- **Module System**: CommonJS (backend), ESM (frontend)

### Package Managers
- **npm**: Primary package manager
- **pnpm**: Supported (lockfiles present)
- **bun**: Supported for faster execution

## Development Commands

### Backend
```bash
npm run build          # Build TypeScript to dist/
npm run release        # Build and publish to npm
```

### Frontend (UI)
```bash
npm run dev            # Start Vite dev server
npm run build          # Build for production
npm run lint           # Run ESLint
npm run preview        # Preview production build
```

### CLI Commands
```bash
ccr init               # Initialize configuration
ccr start              # Start the router server
ccr stop               # Stop the router server
ccr restart            # Restart the router server
ccr code               # Run Claude Code with router
ccr model              # Interactive model management
ccr ui                 # Open web dashboard
ccr status             # Show router status
ccr logs               # View logs
```

## Deployment

### NPM Package
- **Package Name**: @musistudio/claude-code-router
- **Registry**: npm public registry
- **Binary**: ccr command installed globally

### Docker
- **Dockerfile**: Multi-stage build for optimized image
- **docker-compose.yml**: Complete stack deployment
- **Base Image**: Node.js official image

### Configuration
- **Config Directory**: ~/.claude-code-router/
- **Config File**: config.json (JSON5 format)
- **Logs Directory**: ~/.claude-code-router/logs/
- **Metrics Database**: ~/.claude-code-router/metrics.db

## Testing

### Test Framework
- **Location**: test/ directory
- **Types**: Integration tests, utility tests
- **Test Scripts**: Shell scripts for feature testing
  - test_api_key_pool.sh
  - test_shin_mode.sh

## Performance Optimizations

### Build Optimizations
- **esbuild**: Fast bundling with tree-shaking
- **Vite**: Fast HMR and optimized production builds
- **Single File Build**: UI can be bundled to single HTML

### Runtime Optimizations
- **Connection Pooling**: Reuse HTTP connections
- **LRU Cache**: Fast in-memory caching
- **Stream Processing**: Efficient SSE handling
- **SQLite**: Fast local metrics storage

## Security

### Authentication
- **JWT**: Token-based authentication
- **API Keys**: Bearer token or x-api-key header
- **Host Binding**: Forced localhost when no auth

### Secrets Management
- **Environment Variables**: Secure credential storage
- **Config Interpolation**: $VAR_NAME syntax support
- **.gitignore**: Excludes sensitive files

## Monitoring & Observability

### Logging
- **pino**: High-performance logging (server)
- **rotating-file-stream**: Automatic log rotation
- **Dual System**: Server logs + application logs

### Metrics
- **SQLite Database**: Persistent metrics storage
- **Prometheus**: Metrics export support
- **Real-time Tracking**: Token usage, latency, errors

### Health Checks
- **Circuit Breaker**: Automatic failure detection
- **API Key Health**: Monitor key availability
- **System Health**: Overall system status
