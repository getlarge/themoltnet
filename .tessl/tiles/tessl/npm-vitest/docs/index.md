# Vitest

Vitest is a modern JavaScript/TypeScript testing framework built on top of Vite that provides fast, smart watch mode testing with native ESM support and top-level await. It offers Jest-compatible APIs with Chai built-in for assertions, includes advanced features like native code coverage, component testing, browser mode testing, multi-threading, benchmarking, and comprehensive mocking capabilities.

## Package Information

- **Package Name**: vitest
- **Package Type**: npm
- **Language**: TypeScript/JavaScript
- **Installation**: `npm install -D vitest`

## Core Imports

```typescript
import { test, describe, expect, vi } from 'vitest';
```

For globals mode configuration:

```typescript
import { expect, vi } from 'vitest';
// test, describe, it, beforeAll, etc. are available globally
```

CommonJS:

```javascript
const { test, describe, expect, vi } = require('vitest');
```

## Basic Usage

```typescript
import { test, describe, expect, beforeEach } from 'vitest';

describe('Calculator', () => {
  let calculator: Calculator;

  beforeEach(() => {
    calculator = new Calculator();
  });

  test('should add two numbers correctly', () => {
    const result = calculator.add(2, 3);
    expect(result).toBe(5);
  });

  test('should handle async operations', async () => {
    const result = await calculator.asyncMultiply(4, 5);
    expect(result).toBe(20);
  });
});
```

## Architecture

Vitest is built around several key components:

- **Test Runner**: Core test execution engine with file collection, test running, and result reporting
- **Assertion Library**: Chai-based expectations with additional Vitest-specific matchers
- **Mocking System**: Comprehensive module and function mocking with automatic hoisting
- **Configuration System**: Vite-integrated configuration with workspace and project support
- **Reporter System**: Extensible reporting with built-in console, JSON, JUnit and custom reporters
- **Coverage System**: Native code coverage via V8 or Istanbul with multiple output formats
- **Environment System**: Pluggable test environments (Node.js, jsdom, happy-dom, browser)
- **Worker System**: Multi-threaded test execution with thread pools and worker management

## Capabilities

### Core Testing API

Essential test definition and lifecycle functions for organizing and running tests. Compatible with Jest APIs for easy migration.

```typescript { .api }
function test(name: string, fn: TestFunction): void;
function it(name: string, fn: TestFunction): void;
function describe(name: string, fn: () => void): void;
function suite(name: string, fn: () => void): void;

function beforeAll(fn: HookListener): void;
function afterAll(fn: HookListener): void;
function beforeEach(fn: HookListener): void;
function afterEach(fn: HookListener): void;
```

[Core Testing API](./core-testing-api.md)

### Assertion & Expectation API

Comprehensive assertion library with Chai matchers and Vitest-specific extensions for testing values, objects, functions, and async operations.

```typescript { .api }
function expect<T>(value: T): Assertion<T>;
function expect.soft<T>(value: T): Assertion<T>;
function expect.poll(fn: () => any, options?: ExpectPollOptions): Promise<Assertion>;

interface Assertion<T> {
  toBe(expected: T): void;
  toEqual(expected: T): void;
  toMatchObject(expected: object): void;
  toHaveProperty(property: string | string[], value?: any): void;
  // ... extensive Chai matcher API
}
```

[Assertions](./assertions.md)

### Mocking & Spying API

Powerful mocking system for functions, modules, timers, and global variables. Provides Jest-compatible APIs with additional Vitest enhancements.

```typescript { .api }
function vi.fn<T extends (...args: any[]) => any>(implementation?: T): Mock<T>;
function vi.spyOn<T, K extends keyof T>(object: T, method: K): MockInstance;
function vi.mock(path: string, factory?: () => any): void;
function vi.importActual<T>(path: string): Promise<T>;
function vi.importMock<T>(path: string): Promise<Mocked<T>>;

interface Mock<T extends (...args: any[]) => any> extends MockInstance {
  (...args: Parameters<T>): ReturnType<T>;
}
```

[Mocking](./mocking.md)

### Configuration API

Configuration system for test environments, coverage, reporters, and build options. Integrates seamlessly with Vite configuration.

```typescript { .api }
function defineConfig(config: UserConfig): UserConfig;
function defineProject(config: ProjectConfig): ProjectConfig;

interface UserConfig {
  test?: TestConfig;
  // Vite config options also available
}
```

[Configuration](./configuration.md)

### Node.js APIs

Server-side APIs for programmatic test execution, custom reporters, coverage providers, and CLI integration.

```typescript { .api }
class Vitest {
  constructor(mode: VitestRunMode, options: UserConfig);
  start(filters?: string[]): Promise<void>;
  close(): Promise<void>;
}

function createVitest(
  mode: VitestRunMode,
  options: UserConfig,
): Promise<Vitest>;
function startVitest(
  mode: VitestRunMode,
  cliFilters?: string[],
  options?: UserConfig,
): Promise<Vitest | undefined>;
```

[Node.js APIs](./nodejs-apis.md)

### Benchmarking API

Performance testing and benchmarking capabilities with statistical analysis and comparison features.

```typescript { .api }
function bench(name: string, fn: BenchFunction, options?: BenchOptions): void;

interface BenchFunction {
  (): void | Promise<void>;
}

interface BenchOptions {
  iterations?: number;
  time?: number;
  warmupTime?: number;
  warmupIterations?: number;
}
```

[Benchmarking](./benchmarking.md)

### Type Testing API

TypeScript type-level testing utilities for validating type relationships and compile-time behavior.

```typescript { .api }
function expectTypeOf<T>(value: T): ExpectTypeOf<T>;
function assertType<T>(value: T): void;

interface ExpectTypeOf<T> {
  toEqualTypeOf<Expected>(): void;
  toMatchTypeOf<Expected>(): void;
  toBeString(): void;
  toBeNumber(): void;
  // ... additional type matchers
}
```

[Type Testing](./type-testing.md)

## Common Types

```typescript { .api }
interface TestFunction {
  (context: TestContext): void | Promise<void>;
}

interface TestContext {
  task: RunnerTestCase;
  skip(): void;
  onTestFailed(fn: OnTestFailedHandler): void;
  onTestFinished(fn: OnTestFinishedHandler): void;
}

interface HookListener {
  (): void | Promise<void>;
}

type VitestRunMode = 'test' | 'benchmark' | 'typecheck';
```
