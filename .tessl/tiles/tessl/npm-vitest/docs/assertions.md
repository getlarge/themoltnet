# Assertions

Comprehensive assertion library with Chai matchers and Vitest-specific extensions for testing values, objects, functions, and async operations. Provides Jest-compatible APIs with additional powerful features.

## Capabilities

### Core Expect Function

Primary assertion function with extensive matcher support.

```typescript { .api }
/**
 * Create an assertion for the given value
 * @param value - Value to test
 * @returns Assertion object with matcher methods
 */
function expect<T>(value: T): Assertion<T>;

/**
 * Soft assertion that doesn't stop test execution on failure
 * @param value - Value to test
 * @returns Assertion object for soft assertions
 */
function expect.soft<T>(value: T): Assertion<T>;

/**
 * Polling assertion for async conditions
 * @param fn - Function to poll
 * @param options - Polling configuration
 * @returns Promise resolving to assertion
 */
function expect.poll(
  fn: () => any,
  options?: ExpectPollOptions
): Promise<Assertion>;

/**
 * Assert unreachable code paths
 * @param message - Optional error message
 */
function expect.unreachable(message?: string): never;

interface ExpectPollOptions {
  /** Polling interval in milliseconds */
  interval?: number;
  /** Maximum polling timeout in milliseconds */
  timeout?: number;
  /** Custom error message */
  message?: string;
}
```

**Usage Examples:**

```typescript
import { expect } from 'vitest';

// Basic assertions
expect(result).toBe(42);
expect(user.name).toEqual('Alice');

// Soft assertions (continue test even if they fail)
expect.soft(value1).toBe(expected1);
expect.soft(value2).toBe(expected2); // Will run even if first fails

// Polling assertions
await expect.poll(() => getStatus()).toBe('ready');
await expect.poll(() => isElementVisible(), { timeout: 5000 }).toBe(true);

// Unreachable code
if (impossible) {
  expect.unreachable('This should never happen');
}
```

### Expect Configuration

Global configuration for expect behavior.

```typescript { .api }
interface ExpectStatic {
  /** Extend expect with custom matchers */
  extend(matchers: Record<string, any>): void;

  /** Add custom equality testers */
  addEqualityTesters(
    testers: Array<(a: any, b: any) => boolean | undefined>,
  ): void;

  /** Assert exact number of assertions in test */
  assertions(count: number): void;

  /** Assert that at least one assertion is made */
  hasAssertions(): void;

  /** Get current assertion count */
  getAssertions(): number;
}
```

**Usage Examples:**

```typescript
// Custom matchers
expect.extend({
  toBePositive(received) {
    return {
      pass: received > 0,
      message: () => `Expected ${received} to be positive`,
    };
  },
});

// Custom equality testers
expect.addEqualityTesters([
  (a, b) =>
    a instanceof Date && b instanceof Date
      ? a.getTime() === b.getTime()
      : undefined,
]);

// Assertion counting
test('should make exact number of assertions', () => {
  expect.assertions(2);
  expect(value1).toBe(true);
  expect(value2).toBe(false);
});
```

### Value Matchers

Basic value comparison and type checking matchers.

```typescript { .api }
interface Assertion<T> {
  /** Strict equality (===) */
  toBe(expected: T): void;

  /** Deep equality comparison */
  toEqual(expected: T): void;

  /** Strict inequality (!==) */
  not: Assertion<T>;

  /** Type checking */
  toBeTypeOf(
    type:
      | 'string'
      | 'number'
      | 'boolean'
      | 'object'
      | 'function'
      | 'symbol'
      | 'bigint'
      | 'undefined',
  ): void;

  /** Instance checking */
  toBeInstanceOf(constructor: Function): void;

  /** Truthiness */
  toBeTruthy(): void;
  toBeFalsy(): void;

  /** Nullish checking */
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;

  /** NaN checking */
  toBeNaN(): void;
}
```

**Usage Examples:**

```typescript
// Strict equality
expect(result).toBe(42);
expect(name).toBe('Alice');

// Deep equality
expect(user).toEqual({ id: 1, name: 'Alice', active: true });
expect(numbers).toEqual([1, 2, 3]);

// Negation
expect(result).not.toBe(0);
expect(list).not.toEqual([]);

// Type checking
expect(age).toBeTypeOf('number');
expect(callback).toBeTypeOf('function');

// Instance checking
expect(error).toBeInstanceOf(Error);
expect(date).toBeInstanceOf(Date);

// Truthiness
expect(isActive).toBeTruthy();
expect(isDeleted).toBeFalsy();

// Nullish values
expect(optionalValue).toBeNull();
expect(unsetValue).toBeUndefined();
expect(result).toBeDefined();
```

### Number Matchers

Specialized matchers for numeric comparisons and ranges.

```typescript { .api }
interface Assertion<T> {
  /** Greater than */
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;

  /** Less than */
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;

  /** Approximate equality with precision */
  toBeCloseTo(expected: number, precision?: number): void;

  /** Finite number checking */
  toBeFinite(): void;
}
```

**Usage Examples:**

```typescript
expect(score).toBeGreaterThan(80);
expect(temperature).toBeGreaterThanOrEqual(0);
expect(countdown).toBeLessThan(10);
expect(probability).toBeLessThanOrEqual(1);

// Floating point comparison
expect(0.1 + 0.2).toBeCloseTo(0.3);
expect(Math.PI).toBeCloseTo(3.14, 2);

expect(result).toBeFinite();
```

### String Matchers

String-specific matching including patterns and substrings.

```typescript { .api }
interface Assertion<T> {
  /** Substring matching */
  toContain(expected: string): void;

  /** String length */
  toHaveLength(expected: number): void;

  /** Regular expression matching */
  toMatch(expected: string | RegExp): void;

  /** Case-insensitive matching */
  toMatchInlineSnapshot(snapshot?: string): void;
  toMatchSnapshot(hint?: string): void;
}
```

**Usage Examples:**

```typescript
expect(message).toContain('success');
expect(username).toHaveLength(8);
expect(email).toMatch(/^\w+@\w+\.\w+$/);
expect(html).toMatch(/<div.*>.*<\/div>/);

// Snapshot testing
expect(component).toMatchSnapshot();
expect(apiResponse).toMatchInlineSnapshot(`
  {
    "status": "ok",
    "data": []
  }
`);
```

### Array Matchers

Array and iterable-specific matchers.

```typescript { .api }
interface Assertion<T> {
  /** Array length */
  toHaveLength(expected: number): void;

  /** Array/string contains item */
  toContain(expected: any): void;
  toContainEqual(expected: any): void;

  /** Array equality (order matters) */
  toEqual(expected: any[]): void;

  /** Subset matching */
  toEqual(expect.arrayContaining(expected: any[])): void;
}
```

**Usage Examples:**

```typescript
expect(users).toHaveLength(3);
expect(numbers).toContain(42);
expect(objects).toContainEqual({ id: 1, name: 'Alice' });

// Array contains subset (order doesn't matter)
expect([1, 2, 3, 4]).toEqual(expect.arrayContaining([2, 4]));

// Exact array match
expect(sorted).toEqual([1, 2, 3, 4, 5]);
```

### Object Matchers

Object property and structure matching.

```typescript { .api }
interface Assertion<T> {
  /** Object has property */
  toHaveProperty(property: string | string[], value?: any): void;

  /** Object matches subset */
  toMatchObject(expected: object): void;

  /** Object contains all properties */
  toEqual(expect.objectContaining(expected: object)): void;

  /** Object has specific properties */
  toStrictEqual(expected: T): void;
}
```

**Usage Examples:**

```typescript
expect(user).toHaveProperty('id');
expect(user).toHaveProperty('profile.email', 'alice@example.com');
expect(user).toHaveProperty(['profile', 'settings', 'theme'], 'dark');

// Object subset matching
expect(response).toMatchObject({
  status: 200,
  data: { id: 1 },
});

// Object contains properties (ignores extra properties)
expect(user).toEqual(
  expect.objectContaining({
    name: 'Alice',
    email: 'alice@example.com',
  }),
);

// Strict equality (no extra properties allowed)
expect(result).toStrictEqual({ success: true, data: null });
```

### Function Matchers

Function and mock-specific matchers.

```typescript { .api }
interface Assertion<T> {
  /** Function throws error */
  toThrow(expected?: string | RegExp | Error): void;
  toThrowError(expected?: string | RegExp | Error): void;

  /** Function returns value */
  toReturn(): void;
  toReturnWith(expected: any): void;

  /** Mock function calls */
  toHaveBeenCalled(): void;
  toHaveBeenCalledTimes(expected: number): void;
  toHaveBeenCalledWith(...expected: any[]): void;
  toHaveBeenLastCalledWith(...expected: any[]): void;
  toHaveBeenNthCalledWith(call: number, ...expected: any[]): void;

  /** Mock function returns */
  toHaveReturned(): void;
  toHaveReturnedTimes(expected: number): void;
  toHaveReturnedWith(expected: any): void;
  toHaveLastReturnedWith(expected: any): void;
  toHaveNthReturnedWith(call: number, expected: any): void;
}
```

**Usage Examples:**

```typescript
// Function throws
expect(() => throwError()).toThrow();
expect(() => throwError()).toThrow('Invalid input');
expect(() => throwError()).toThrow(/invalid/i);
expect(() => throwError()).toThrowError(ValidationError);

// Mock function calls
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledTimes(2);
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
expect(mockFn).toHaveBeenLastCalledWith('lastArg');
expect(mockFn).toHaveBeenNthCalledWith(2, 'secondCallArg');

// Mock function returns
expect(mockFn).toHaveReturned();
expect(mockFn).toHaveReturnedTimes(3);
expect(mockFn).toHaveReturnedWith('success');
expect(mockFn).toHaveLastReturnedWith('final');
expect(mockFn).toHaveNthReturnedWith(1, 'first');
```

### Async Matchers

Matchers for promises and async operations.

```typescript { .api }
interface Assertion<T> {
  /** Promise resolves */
  resolves: Assertion<Awaited<T>>;

  /** Promise rejects */
  rejects: Assertion<any>;
}
```

**Usage Examples:**

```typescript
// Promise resolves
await expect(fetchUser()).resolves.toEqual({ id: 1, name: 'Alice' });
await expect(processData()).resolves.toBeTruthy();

// Promise rejects
await expect(failingOperation()).rejects.toThrow();
await expect(invalidRequest()).rejects.toThrow('Invalid request');
await expect(networkError()).rejects.toBeInstanceOf(NetworkError);
```

## Alternative Assertion Styles

```typescript { .api }
/** Chai assert style */
const assert: typeof import('chai').assert;

/** Chai should style */
const should: typeof import('chai').should;

/** Raw Chai object */
const chai: typeof import('chai');

/** Create custom expect function */
function createExpect(extend?: any): typeof expect;
```

**Usage Examples:**

```typescript
import { assert, should, chai } from 'vitest';

// Assert style
assert.equal(result, 42);
assert.isTrue(isValid);
assert.deepEqual(object, expected);

// Should style (requires should())
should();
result.should.equal(42);
isValid.should.be.true;

// Custom expect
const customExpect = createExpect({
  toBeAwesome: (received) => ({
    pass: received === 'awesome',
    message: () => `Expected ${received} to be awesome`,
  }),
});
```
