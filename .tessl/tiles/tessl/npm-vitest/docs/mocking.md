# Mocking

Powerful mocking system for functions, modules, timers, and global variables. Provides Jest-compatible APIs with additional Vitest enhancements for comprehensive test isolation and behavior simulation.

## Capabilities

### Mock Functions

Create and manage mock functions with call tracking and return value control.

```typescript { .api }
/**
 * Create a mock function
 * @param implementation - Optional function implementation
 * @returns Mock function with tracking capabilities
 */
function vi.fn<T extends (...args: any[]) => any>(implementation?: T): Mock<T>;

/**
 * Spy on existing object method
 * @param object - Target object
 * @param method - Method name to spy on
 * @returns Mock instance for the method
 */
function vi.spyOn<T, K extends keyof T>(object: T, method: K): MockInstance;

/**
 * Check if value is a mock function
 * @param fn - Function to check
 * @returns True if function is a mock
 */
function vi.isMockFunction(fn: any): fn is Mock;

/**
 * Type helper for mocked objects
 * @param item - Object to type as mocked
 * @returns Typed mocked object
 */
function vi.mocked<T>(item: T): Mocked<T>;

interface Mock<T extends (...args: any[]) => any = (...args: any[]) => any> extends MockInstance {
  (...args: Parameters<T>): ReturnType<T>;
}

interface MockInstance {
  /** Mock call history */
  mock: {
    calls: any[][];
    results: MockResult[];
    instances: any[];
    contexts: any[];
    lastCall?: any[];
  };

  /** Set return value */
  mockReturnValue(value: any): this;
  mockReturnValueOnce(value: any): this;

  /** Set resolved value for async functions */
  mockResolvedValue(value: any): this;
  mockResolvedValueOnce(value: any): this;

  /** Set rejected value for async functions */
  mockRejectedValue(value: any): this;
  mockRejectedValueOnce(value: any): this;

  /** Set implementation */
  mockImplementation(fn: (...args: any[]) => any): this;
  mockImplementationOnce(fn: (...args: any[]) => any): this;

  /** Clear call history */
  mockClear(): this;

  /** Reset to original implementation */
  mockReset(): this;

  /** Restore original method (for spies) */
  mockRestore(): this;
}
```

**Usage Examples:**

```typescript
import { vi, expect } from 'vitest';

// Create mock function
const mockFn = vi.fn();
const mockWithImpl = vi.fn((x: number) => x * 2);

// Call mock
mockFn('arg1', 'arg2');
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');

// Spy on object method
const calculator = { add: (a: number, b: number) => a + b };
const addSpy = vi.spyOn(calculator, 'add');
calculator.add(1, 2);
expect(addSpy).toHaveBeenCalledWith(1, 2);

// Mock return values
mockFn.mockReturnValue('mocked result');
mockFn.mockReturnValueOnce('one time result');

// Mock async functions
const asyncMock = vi.fn();
asyncMock.mockResolvedValue({ data: 'success' });
asyncMock.mockRejectedValue(new Error('failed'));

// Mock implementation
mockFn.mockImplementation((name: string) => `Hello ${name}`);
```

### Module Mocking

Mock entire modules and their exports.

```typescript { .api }
/**
 * Mock a module (hoisted to top of file)
 * @param path - Module path to mock
 * @param factory - Optional factory function for mock implementation
 */
function vi.mock(path: string, factory?: () => any): void;

/**
 * Remove module mock (hoisted to top of file)
 * @param path - Module path to unmock
 */
function vi.unmock(path: string): void;

/**
 * Mock a module (not hoisted)
 * @param path - Module path to mock
 * @param factory - Optional factory function for mock implementation
 */
function vi.doMock(path: string, factory?: () => any): void;

/**
 * Remove module mock (not hoisted)
 * @param path - Module path to unmock
 */
function vi.doUnmock(path: string): void;

/**
 * Import actual module bypassing mocks
 * @param path - Module path to import
 * @returns Promise resolving to actual module
 */
function vi.importActual<T>(path: string): Promise<T>;

/**
 * Import mocked module
 * @param path - Module path to import
 * @returns Promise resolving to mocked module
 */
function vi.importMock<T>(path: string): Promise<Mocked<T>>;

/**
 * Run factory function before imports (hoisted)
 * @param factory - Function to run before imports
 * @returns Factory return value
 */
function vi.hoisted<T>(factory: () => T): T;
```

**Usage Examples:**

```typescript
import { vi } from 'vitest';

// Mock entire module
vi.mock('axios', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

// Partial mock with actual imports
vi.mock('./utils', async () => {
  const actual = await vi.importActual('./utils');
  return {
    ...actual,
    fetchData: vi.fn(() => Promise.resolve('mocked data')),
  };
});

// Dynamic mocking
vi.doMock('./config', () => ({
  apiUrl: 'http://localhost:3000',
  debug: true,
}));

// Hoisted mock setup
const mockData = vi.hoisted(() => ({ users: [] }));
vi.mock('./database', () => ({
  getUsers: vi.fn(() => mockData.users),
}));
```

### Mock Object Utilities

Utilities for mocking object properties and methods.

```typescript { .api }
/**
 * Deep mock object properties
 * @param object - Object to mock
 * @param deep - Whether to deeply mock nested objects
 * @returns Mocked object
 */
function vi.mockObject<T>(object: T, deep?: boolean): Mocked<T>;

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? Mock<T[K]>
    : T[K] extends object
    ? Mocked<T[K]>
    : T[K];
} & T;
```

**Usage Examples:**

```typescript
// Mock object methods
const service = {
  fetchUser: (id: string) => ({ id, name: 'Alice' }),
  saveUser: (user: any) => Promise.resolve(user),
  nested: {
    method: () => 'original',
  },
};

const mockedService = vi.mockObject(service, true);
mockedService.fetchUser.mockReturnValue({ id: '123', name: 'Mocked User' });
mockedService.nested.method.mockReturnValue('mocked');
```

### Mock Management

Global mock management and cleanup.

```typescript { .api }
/**
 * Clear call history for all mocks
 */
function vi.clearAllMocks(): void;

/**
 * Reset all mocks to original state
 */
function vi.resetAllMocks(): void;

/**
 * Restore all mocks to original implementations
 */
function vi.restoreAllMocks(): void;
```

**Usage Examples:**

```typescript
import { vi, beforeEach } from 'vitest';

beforeEach(() => {
  // Clear call history before each test
  vi.clearAllMocks();
});

afterEach(() => {
  // Reset all mocks after each test
  vi.resetAllMocks();
});

afterAll(() => {
  // Restore original implementations
  vi.restoreAllMocks();
});
```

### Fake Timers

Mock and control time-based functions.

```typescript { .api }
/**
 * Enable fake timers
 * @param config - Timer configuration
 */
function vi.useFakeTimers(config?: FakeTimerInstallOpts): void;

/**
 * Restore real timers
 */
function vi.useRealTimers(): void;

/**
 * Check if fake timers are active
 */
function vi.isFakeTimers(): boolean;

/**
 * Run only currently pending timers
 */
function vi.runOnlyPendingTimers(): void;
function vi.runOnlyPendingTimersAsync(): Promise<void>;

/**
 * Run all timers including those created during execution
 */
function vi.runAllTimers(): void;
function vi.runAllTimersAsync(): Promise<void>;

/**
 * Run all microtasks
 */
function vi.runAllTicks(): void;

/**
 * Advance time by milliseconds
 */
function vi.advanceTimersByTime(ms: number): void;
function vi.advanceTimersByTimeAsync(ms: number): Promise<void>;

/**
 * Advance to next timer
 */
function vi.advanceTimersToNextTimer(): void;
function vi.advanceTimersToNextTimerAsync(): Promise<void>;

/**
 * Advance to next animation frame
 */
function vi.advanceTimersToNextFrame(): void;

/**
 * Get number of pending timers
 */
function vi.getTimerCount(): number;

/**
 * Clear all pending timers
 */
function vi.clearAllTimers(): void;

interface FakeTimerInstallOpts {
  /** Timer types to fake */
  toFake?: ("setTimeout" | "clearTimeout" | "setInterval" | "clearInterval" | "Date")[];
  /** Whether to fake global Date */
  shouldAdvanceTime?: boolean;
  /** Advanced time step */
  advanceTimeDelta?: number;
}
```

**Usage Examples:**

```typescript
import { vi, test, expect } from 'vitest';

test('timer mocking', () => {
  vi.useFakeTimers();

  const callback = vi.fn();
  setTimeout(callback, 1000);

  // Timer hasn't run yet
  expect(callback).not.toHaveBeenCalled();

  // Advance time
  vi.advanceTimersByTime(1000);
  expect(callback).toHaveBeenCalled();

  vi.useRealTimers();
});

test('async timer operations', async () => {
  vi.useFakeTimers();

  const promise = new Promise((resolve) => {
    setTimeout(() => resolve('done'), 500);
  });

  // Advance time and wait
  const resultPromise = promise;
  await vi.advanceTimersByTimeAsync(500);
  const result = await resultPromise;

  expect(result).toBe('done');
});
```

### System Time Mocking

Mock system time and dates.

```typescript { .api }
/**
 * Mock system time to specific date
 * @param date - Date to set as current time
 */
function vi.setSystemTime(date: string | number | Date): void;

/**
 * Get mocked system time
 */
function vi.getMockedSystemTime(): Date | null;

/**
 * Get real system time
 */
function vi.getRealSystemTime(): Date;
```

**Usage Examples:**

```typescript
import { vi, test, expect } from 'vitest';

test('date mocking', () => {
  const mockDate = new Date('2023-01-15T10:00:00.000Z');
  vi.setSystemTime(mockDate);

  expect(new Date()).toEqual(mockDate);
  expect(Date.now()).toBe(mockDate.getTime());

  // Reset to real time
  vi.useRealTimers();
});
```

### Environment Mocking

Mock global variables and environment settings.

```typescript { .api }
/**
 * Mock global variable
 * @param name - Global variable name
 * @param value - Mock value
 */
function vi.stubGlobal(name: string | number | symbol, value: any): void;

/**
 * Restore all stubbed globals
 */
function vi.unstubAllGlobals(): void;

/**
 * Mock environment variable
 * @param name - Environment variable name
 * @param value - Mock value
 */
function vi.stubEnv(name: string, value: string): void;

/**
 * Restore all stubbed environment variables
 */
function vi.unstubAllEnvs(): void;
```

**Usage Examples:**

```typescript
import { vi, test, expect } from 'vitest';

test('global mocking', () => {
  // Mock window.location
  vi.stubGlobal('window', {
    location: { href: 'http://localhost:3000' },
  });

  expect(window.location.href).toBe('http://localhost:3000');

  // Mock environment variable
  vi.stubEnv('NODE_ENV', 'test');
  expect(process.env.NODE_ENV).toBe('test');

  // Cleanup
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
```

### Module Cache Management

Control module caching and dynamic imports.

```typescript { .api }
/**
 * Clear module cache
 */
function vi.resetModules(): void;

/**
 * Wait for dynamic imports to settle
 */
function vi.dynamicImportSettled(): Promise<void>;
```

**Usage Examples:**

```typescript
import { vi, test } from 'vitest';

test('module cache', async () => {
  // Clear module cache to ensure fresh imports
  vi.resetModules();

  const module = await import('./dynamic-module');

  // Wait for any dynamic imports within the module
  await vi.dynamicImportSettled();
});
```

### Runtime Configuration

Control Vitest runtime configuration from tests.

```typescript { .api }
/**
 * Update runtime configuration
 * @param config - Configuration updates
 */
function vi.setConfig(config: RuntimeConfig): void;

/**
 * Reset to original configuration
 */
function vi.resetConfig(): void;
```

**Usage Examples:**

```typescript
import { vi, test } from 'vitest';

test('runtime config', () => {
  vi.setConfig({
    testTimeout: 10000,
    hookTimeout: 5000,
  });

  // Test with updated config
  // ...

  vi.resetConfig();
});
```

### Async Utilities

Utilities for waiting and async operations.

```typescript { .api }
/**
 * Wait for condition with retries
 * @param callback - Function to test
 * @param options - Wait configuration
 */
function vi.waitFor<T>(
  callback: () => T | Promise<T>,
  options?: WaitForOptions
): Promise<T>;

/**
 * Wait until condition is truthy
 * @param callback - Function to test
 * @param options - Wait configuration
 */
function vi.waitUntil<T>(
  callback: () => T | Promise<T>,
  options?: WaitUntilOptions
): Promise<T>;

interface WaitForOptions {
  timeout?: number;
  interval?: number;
}

interface WaitUntilOptions {
  timeout?: number;
  interval?: number;
}
```

**Usage Examples:**

```typescript
import { vi, test, expect } from 'vitest';

test('async waiting', async () => {
  let counter = 0;
  const increment = () => counter++;

  // Wait for condition
  await vi.waitFor(() => {
    increment();
    return counter >= 5;
  });

  expect(counter).toBeGreaterThanOrEqual(5);

  // Wait until value is truthy
  const getValue = () => (counter > 10 ? 'ready' : null);
  const result = await vi.waitUntil(getValue, { timeout: 1000 });
  expect(result).toBe('ready');
});
```
