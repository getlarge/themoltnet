# Core Testing API

Essential test definition and lifecycle functions for organizing and running tests. Provides Jest-compatible APIs for easy migration from existing test suites.

## Capabilities

### Test Definition

Define individual test cases and test suites.

```typescript { .api }
/**
 * Define a test case
 * @param name - Test description
 * @param fn - Test function to execute
 */
function test(name: string, fn: TestFunction): void;
function test(name: string, options: TestOptions, fn: TestFunction): void;

/**
 * Alias for test()
 */
function it(name: string, fn: TestFunction): void;
function it(name: string, options: TestOptions, fn: TestFunction): void;

interface TestFunction {
  (context: TestContext): void | Promise<void>;
}

interface TestOptions {
  /** Test timeout in milliseconds */
  timeout?: number;
  /** Number of times to retry flaky tests */
  retry?: number;
  /** Run test concurrently with others in same describe block */
  concurrent?: boolean;
  /** Skip test execution */
  skip?: boolean;
  /** Only run this test (ignore others) */
  only?: boolean;
  /** Mark test as todo (not implemented) */
  todo?: boolean;
  /** Run test only if condition is true */
  runIf?: boolean;
  /** Skip test if condition is true */
  skipIf?: boolean;
  /** Additional metadata for the test */
  meta?: Record<string, any>;
}
```

**Usage Examples:**

```typescript
import { test, it } from 'vitest';

// Basic test
test('should calculate sum correctly', () => {
  expect(add(2, 3)).toBe(5);
});

// Async test
test('should fetch user data', async () => {
  const users = await fetchUsers();
  expect(users).toHaveLength(10);
});

// Test with options
test('long running operation', { timeout: 10000 }, async () => {
  await processLargeDataset();
});

// Concurrent test
test.concurrent('parallel test 1', async () => {
  await delay(100);
  expect(true).toBe(true);
});
```

### Suite Definition

Group related tests into suites and nested suites.

```typescript { .api }
/**
 * Group tests into a suite
 * @param name - Suite description
 * @param fn - Function containing test definitions
 */
function describe(name: string, fn: () => void): void;
function describe(name: string, options: SuiteOptions, fn: () => void): void;

/**
 * Alias for describe()
 */
function suite(name: string, fn: () => void): void;
function suite(name: string, options: SuiteOptions, fn: () => void): void;

interface SuiteOptions {
  /** Suite timeout in milliseconds */
  timeout?: number;
  /** Number of times to retry all tests in suite */
  retry?: number;
  /** Run all tests in suite concurrently */
  concurrent?: boolean;
  /** Skip entire suite */
  skip?: boolean;
  /** Only run this suite (ignore others) */
  only?: boolean;
  /** Mark suite as todo */
  todo?: boolean;
  /** Run suite only if condition is true */
  runIf?: boolean;
  /** Skip suite if condition is true */
  skipIf?: boolean;
  /** Shuffle tests in suite */
  shuffle?: boolean;
}
```

**Usage Examples:**

```typescript
import { describe, test } from 'vitest';

describe('Calculator', () => {
  test('should add numbers', () => {
    expect(add(1, 2)).toBe(3);
  });

  test('should subtract numbers', () => {
    expect(subtract(5, 3)).toBe(2);
  });

  // Nested suites
  describe('advanced operations', () => {
    test('should calculate square root', () => {
      expect(sqrt(9)).toBe(3);
    });
  });
});

// Concurrent suite
describe.concurrent('API tests', () => {
  test('endpoint 1', async () => {
    /* ... */
  });
  test('endpoint 2', async () => {
    /* ... */
  });
});
```

### Test Modifiers

Modify test and suite behavior with chainable modifiers.

```typescript { .api }
interface TestAPI {
  /** Skip this test */
  skip: typeof test;
  /** Only run this test */
  only: typeof test;
  /** Mark test as todo */
  todo: typeof test;
  /** Run test concurrently */
  concurrent: typeof test;
  /** Skip test if condition is true */
  skipIf: (condition: boolean) => typeof test;
  /** Run test only if condition is true */
  runIf: (condition: boolean) => typeof test;
  /** Run test multiple times */
  each<T>(
    cases: ReadonlyArray<T>,
  ): (name: string, fn: (args: T) => void) => void;
}

interface SuiteAPI {
  /** Skip this suite */
  skip: typeof describe;
  /** Only run this suite */
  only: typeof describe;
  /** Mark suite as todo */
  todo: typeof describe;
  /** Run suite concurrently */
  concurrent: typeof describe;
  /** Skip suite if condition is true */
  skipIf: (condition: boolean) => typeof describe;
  /** Run suite only if condition is true */
  runIf: (condition: boolean) => typeof describe;
  /** Shuffle tests in suite */
  shuffle: typeof describe;
}
```

**Usage Examples:**

```typescript
// Skip tests conditionally
test.skipIf(process.platform === 'win32')('unix-specific test', () => {
  // Only runs on non-Windows platforms
});

// Run only specific tests during development
test.only('debugging this test', () => {
  // Only this test will run
});

// Parametric tests
test.each([
  [1, 2, 3],
  [2, 3, 5],
  [3, 4, 7],
])('add(%i, %i) = %i', (a, b, expected) => {
  expect(add(a, b)).toBe(expected);
});

// Todo tests
test.todo('implement user authentication');

// Concurrent tests
test.concurrent('parallel test', async () => {
  await delay(100);
});
```

### Lifecycle Hooks

Setup and teardown functions that run before/after tests and suites.

```typescript { .api }
/**
 * Run once before all tests in the current suite
 */
function beforeAll(fn: HookListener): void;
function beforeAll(fn: HookListener, timeout?: number): void;

/**
 * Run once after all tests in the current suite
 */
function afterAll(fn: HookListener): void;
function afterAll(fn: HookListener, timeout?: number): void;

/**
 * Run before each test in the current suite
 */
function beforeEach(fn: HookListener): void;
function beforeEach(fn: HookListener, timeout?: number): void;

/**
 * Run after each test in the current suite
 */
function afterEach(fn: HookListener): void;
function afterEach(fn: HookListener, timeout?: number): void;

interface HookListener {
  (context: TaskContext): void | Promise<void>;
}
```

**Usage Examples:**

```typescript
import {
  describe,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';

describe('Database tests', () => {
  let database: Database;

  beforeAll(async () => {
    // Setup once for all tests
    database = await createTestDatabase();
  });

  afterAll(async () => {
    // Cleanup once after all tests
    await database.close();
  });

  beforeEach(async () => {
    // Reset state before each test
    await database.clear();
  });

  afterEach(async () => {
    // Cleanup after each test
    await database.rollback();
  });

  test('should create user', async () => {
    const user = await database.createUser({ name: 'Alice' });
    expect(user.id).toBeDefined();
  });
});
```

### Test Callbacks

Register callbacks that execute when tests fail or finish.

```typescript { .api }
/**
 * Register callback for when test fails
 */
function onTestFailed(fn: OnTestFailedHandler): void;

/**
 * Register callback for when test finishes (pass or fail)
 */
function onTestFinished(fn: OnTestFinishedHandler): void;

interface OnTestFailedHandler {
  (result: TaskResult): void | Promise<void>;
}

interface OnTestFinishedHandler {
  (result: TaskResult): void | Promise<void>;
}
```

**Usage Examples:**

```typescript
import { test, onTestFailed, onTestFinished } from 'vitest';

test('might fail', () => {
  onTestFailed(async (result) => {
    // Take screenshot on failure
    await captureScreenshot(`failed-${result.task.name}`);
  });

  onTestFinished(async (result) => {
    // Cleanup resources regardless of result
    await cleanup();
  });

  // Test logic here
  expect(riskyOperation()).toBeTruthy();
});
```

## Common Types

```typescript { .api }
interface TestContext extends TaskContext {
  /** Skip remaining tests in current suite */
  skip(): void;
}

interface TaskContext {
  /** Current task being executed */
  task: RunnerTask;
  /** Register test failure callback */
  onTestFailed(fn: OnTestFailedHandler): void;
  /** Register test finished callback */
  onTestFinished(fn: OnTestFinishedHandler): void;
}

interface TaskResult {
  /** Current task */
  task: RunnerTask;
  /** Test state */
  state: TaskState;
  /** Test duration in milliseconds */
  duration?: number;
  /** Error if test failed */
  errors?: TestError[];
  /** Result metadata */
  meta?: TaskMeta;
}

type TaskState = 'todo' | 'skip' | 'pass' | 'fail' | 'only' | 'run';
```
