# Development Guidelines

## Code Quality Standards

### TypeScript Configuration
- **Strict Mode**: Always enabled with `strict: true`
- **Target**: ES2022 for modern JavaScript features
- **Module System**: CommonJS for backend, ESM for frontend
- **Type Safety**: `noImplicitAny: true` - all types must be explicit
- **Source Maps**: Enabled for debugging
- **Declaration Files**: Generated for library usage

### Code Formatting
- **Indentation**: 2 spaces (consistent across TypeScript and React)
- **Semicolons**: Required at end of statements
- **Quotes**: Double quotes for strings
- **Line Length**: No strict limit, but prefer readability
- **Trailing Commas**: Used in multi-line objects and arrays

### Naming Conventions
- **Files**: camelCase for utilities (e.g., `apiKeyPool.ts`), PascalCase for components (e.g., `LogViewer.tsx`)
- **Classes**: PascalCase (e.g., `AuthManager`, `CircuitBreaker`)
- **Functions**: camelCase (e.g., `createServer`, `handleModuleChange`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `CONFIG_FILE`, `HOME_DIR`)
- **Interfaces**: PascalCase with descriptive names (e.g., `StatusLineConfig`, `LogEntry`)
- **Type Aliases**: PascalCase (e.g., `StatusLineModuleConfig`)
- **Private Methods**: Prefix with underscore is not used; rely on TypeScript private keyword

### Documentation
- **JSDoc Comments**: Used for complex functions and public APIs
- **Inline Comments**: Minimal; code should be self-documenting
- **Chinese Comments**: Present in some files (e.g., statusline.ts) for Chinese-speaking developers
- **Type Annotations**: Comprehensive for function parameters and return types

## Architectural Patterns

### Singleton Pattern
Used extensively for shared services:
```typescript
export const authManager = new AuthManager();
export const metricsCollector = new MetricsCollector();
export const apiKeyPool = new ApiKeyPool();
```
- Single instance exported from module
- Cleanup functions provided for proper shutdown

### Middleware Pattern
Fastify hooks used for request processing pipeline:
```typescript
server.app.addHook('preHandler', cacheMiddleware);
server.app.addHook('preHandler', metricsMiddleware);
server.app.addHook('onResponse', collectResponseMetrics);
```
- Order matters: cache → metrics → auth → routing
- Each middleware has specific responsibility
- Context passed via request object properties (e.g., `__metricsContext`)

### Factory Pattern
Server creation with dependency injection:
```typescript
export const createServer = (config: any): Server => {
  // Initialize services based on config
  // Register middleware
  // Return configured server
}
```

### Observer Pattern
Event-driven metrics updates:
```typescript
metricsCollector.on('metricsUpdated', onMetricsUpdate);
```

### Strategy Pattern
API key selection strategies:
```typescript
apiKeyPool.setStrategy(apiKeyPoolConfig.strategy);
// Strategies: round-robin, least-used, priority-based
```

## React Patterns

### Hooks Usage
- **useState**: For local component state
- **useEffect**: For side effects, cleanup functions always provided
- **useRef**: For DOM references and mutable values that don't trigger re-renders
- **useCallback**: For memoizing event handlers
- **useMemo**: For expensive computations
- **Custom Hooks**: Not heavily used; prefer composition

### Component Structure
```typescript
export function ComponentName({ prop1, prop2 }: ComponentProps) {
  // 1. Hooks (useState, useEffect, etc.)
  // 2. Derived state and computations
  // 3. Event handlers
  // 4. Render logic
}
```

### State Management
- **Local State**: useState for component-specific state
- **Context**: Used for config sharing (ConfigProvider)
- **Props Drilling**: Acceptable for shallow hierarchies
- **No Redux**: Project doesn't use global state management library

### Component Composition
- **Compound Components**: Used in UI library (Dialog, DialogContent, DialogHeader)
- **Render Props**: Not commonly used
- **Higher-Order Components**: Not used; prefer hooks

## Error Handling

### Backend Error Handling
```typescript
try {
  // Operation
} catch (error) {
  console.error('Failed to ...:', error);
  reply.status(500).send({ error: 'Failed to ...' });
}
```
- Always log errors with context
- Return appropriate HTTP status codes
- Provide user-friendly error messages

### Frontend Error Handling
```typescript
try {
  // API call
} catch (error) {
  console.error('Failed to ...:', error);
  if (showToast) {
    showToast(t('error.message') + ': ' + (error as Error).message, 'error');
  }
}
```
- Use toast notifications for user feedback
- Internationalized error messages
- Type assertion for error objects

### Validation
- **Config Validation**: Dedicated validation functions with detailed error messages
- **Input Validation**: Check for null/undefined before operations
- **Type Guards**: Used for runtime type checking

## Async Patterns

### Promise Handling
```typescript
async function loadData() {
  try {
    setIsLoading(true);
    const response = await api.getData();
    setData(response);
  } catch (error) {
    handleError(error);
  } finally {
    setIsLoading(false);
  }
}
```
- Always use try-catch-finally
- Set loading states appropriately
- Clean up in finally block

### Cleanup
```typescript
useEffect(() => {
  const interval = setInterval(() => {
    // Periodic task
  }, 1000);
  
  return () => {
    clearInterval(interval);
  };
}, [dependencies]);
```
- Always return cleanup function from useEffect
- Clear intervals, timeouts, and event listeners
- Terminate workers and close connections

## API Design

### RESTful Endpoints
```typescript
server.app.get('/api/resource', handler);
server.app.post('/api/resource', handler);
server.app.put('/api/resource/:id', handler);
server.app.delete('/api/resource/:id', handler);
```
- Consistent URL structure: `/api/resource`
- Use HTTP verbs appropriately
- Return JSON responses

### Response Format
```typescript
// Success
return { success: true, data: result };

// Error
reply.status(500).send({ error: 'Error message' });
```
- Consistent response structure
- Include success flag for operations
- Detailed error messages

### Query Parameters
```typescript
const query = req.query as any;
const limit = parseInt(query.limit) || 100;
```
- Type cast query parameters
- Provide defaults for optional parameters
- Validate and sanitize inputs

## Performance Optimizations

### Memoization
```typescript
const memoizedValue = useMemo(() => {
  return expensiveComputation(data);
}, [data]);
```
- Use for expensive computations
- Specify dependencies carefully

### Debouncing/Throttling
- Not heavily used in codebase
- Implemented manually when needed

### Web Workers
```typescript
const worker = new Worker(workerUrl);
worker.onmessage = (event) => {
  // Handle result
};
worker.postMessage({ type: 'task', data });
```
- Used for CPU-intensive tasks (log grouping)
- Inline worker creation for portability
- Proper cleanup on unmount

### Connection Pooling
- HTTP connection reuse for API calls
- Session affinity for stateful connections
- Configurable pool sizes per provider

## Testing Patterns

### Test Structure
- Integration tests in `test/integration/`
- Utility tests in `test/utils/`
- Shell scripts for feature testing

### Test Naming
- Descriptive test file names matching source files
- Test scripts: `test_*.sh`

## Security Practices

### Authentication
- JWT-based authentication with configurable secret
- API key authentication via headers
- Role-based access control (RBAC)

### Input Sanitization
- Environment variable interpolation with validation
- Query parameter validation
- File path validation to prevent traversal

### Secrets Management
- Environment variables for sensitive data
- No hardcoded credentials
- Config files excluded from version control

### Rate Limiting
- Token bucket algorithm
- Per-user and per-provider limits
- Configurable thresholds

## Internationalization

### i18n Setup
```typescript
import { useTranslation } from 'react-i18next';

const { t } = useTranslation();
const label = t('key.path');
```
- Translation keys in dot notation
- Separate locale files for each language
- Browser language detection

### Translation Keys
- Organized by feature/component
- Descriptive key names
- Fallback to English

## Logging Standards

### Backend Logging
```typescript
console.log('[FEATURE] Message with context');
console.error('Error message:', error);
```
- Prefix with feature tag in brackets
- Include context information
- Use appropriate log levels

### Frontend Logging
```typescript
console.log('Component action:', data);
console.error('Failed to ...:', error);
```
- Descriptive messages
- Include relevant data
- Remove debug logs in production

## Configuration Management

### Config Structure
- JSON5 format for comments support
- Nested configuration objects
- Environment variable interpolation: `$VAR_NAME` or `${VAR_NAME}`

### Config Loading
```typescript
const config = JSON5.parse(configContent);
// Interpolate environment variables
const interpolated = interpolateEnvVars(config);
```

### Config Validation
- Validate on load
- Provide helpful error messages
- Use default values when appropriate

## Common Code Idioms

### Optional Chaining
```typescript
const value = obj?.property?.nested;
```
- Used extensively for safe property access

### Nullish Coalescing
```typescript
const value = config.setting ?? defaultValue;
```
- Preferred over `||` for default values

### Array Methods
```typescript
const filtered = items.filter(item => condition);
const mapped = items.map(item => transform(item));
const found = items.find(item => item.id === id);
```
- Functional array operations preferred
- Avoid mutating original arrays

### Object Destructuring
```typescript
const { property1, property2 } = object;
const { data, error } = await apiCall();
```
- Used for cleaner code
- Rename with aliases when needed

### Spread Operator
```typescript
const newObj = { ...oldObj, updated: value };
const newArr = [...oldArr, newItem];
```
- Immutable updates preferred
- Used for shallow copies

## Module Organization

### Exports
```typescript
// Named exports preferred
export function utilityFunction() {}
export class ClassName {}

// Default export for main component
export default function Component() {}
```

### Imports
```typescript
// Absolute imports with path aliases
import { utility } from '@/utils';
import Component from '@/components/Component';

// Relative imports for local files
import { helper } from './helper';
```

### Barrel Exports
```typescript
// index.ts
export * from './module1';
export * from './module2';
```
- Used in utils and components directories

## Type Definitions

### Interface vs Type
- **Interfaces**: For object shapes, can be extended
- **Type Aliases**: For unions, intersections, primitives

### Type Annotations
```typescript
function process(data: DataType): ResultType {
  // Implementation
}
```
- Always annotate function parameters
- Always annotate return types
- Infer types for local variables when obvious

### Generic Types
```typescript
function identity<T>(value: T): T {
  return value;
}
```
- Used sparingly
- Prefer concrete types when possible

## Best Practices Summary

1. **Type Safety**: Leverage TypeScript's type system fully
2. **Error Handling**: Always handle errors gracefully with user feedback
3. **Cleanup**: Always clean up resources (intervals, listeners, workers)
4. **Immutability**: Prefer immutable updates for state
5. **Composition**: Favor composition over inheritance
6. **Single Responsibility**: Each function/component has one clear purpose
7. **DRY**: Extract common logic into utilities
8. **Readability**: Code should be self-documenting
9. **Performance**: Optimize only when necessary, measure first
10. **Security**: Validate inputs, sanitize outputs, protect secrets
