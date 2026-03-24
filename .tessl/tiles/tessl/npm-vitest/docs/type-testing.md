# Type Testing

TypeScript type-level testing utilities for validating type relationships and compile-time behavior. Test your types as rigorously as your runtime code.

## Capabilities

### Type Expectation API

Comprehensive type-level assertions for validating TypeScript types.

```typescript { .api }
/**
 * Create type expectation for compile-time type testing
 * @param value - Value to test (used for type inference)
 * @returns Type expectation object with assertion methods
 */
function expectTypeOf<T>(value: T): ExpectTypeOf<T>;
function expectTypeOf<T>(): ExpectTypeOf<T>;

/**
 * Type expectation interface with assertion methods
 */
interface ExpectTypeOf<T> {
  /** Assert exact type equality */
  toEqualTypeOf<Expected>(): void;

  /** Assert type compatibility (assignability) */
  toMatchTypeOf<Expected>(): void;

  /** Assert types are different */
  not: ExpectTypeOf<T>;

  /** Primitive type assertions */
  toBeString(): void;
  toBeNumber(): void;
  toBeBoolean(): void;
  toBeBigInt(): void;
  toBeSymbol(): void;
  toBeUndefined(): void;
  toBeNull(): void;
  toBeUnknown(): void;
  toBeAny(): void;
  toBeNever(): void;
  toBeVoid(): void;

  /** Object type assertions */
  toBeObject(): void;
  toBeArray(): void;
  toBeFunction(): void;

  /** Utility type assertions */
  toBeCallable(): void;
  toBeConstructible(): void;

  /** Property testing */
  toHaveProperty<K extends keyof T>(key: K): ExpectTypeOf<T[K]>;

  /** Array/tuple testing */
  toHaveLength<N extends number>(): void;

  /** Function testing */
  parameter<N extends number>(n: N): ExpectTypeOf<Parameters<T>[N]>;
  parameters: ExpectTypeOf<Parameters<T>>;
  returns: ExpectTypeOf<ReturnType<T>>;

  /** Promise testing */
  resolves: T extends Promise<infer U> ? ExpectTypeOf<U> : never;

  /** Branded/nominal type testing */
  branded: ExpectTypeOf<T>;
}
```

**Usage Examples:**

```typescript
import { expectTypeOf } from 'vitest';

// Basic type assertions
expectTypeOf('hello').toBeString();
expectTypeOf(42).toBeNumber();
expectTypeOf(true).toBeBoolean();
expectTypeOf([1, 2, 3]).toBeArray();
expectTypeOf({ name: 'Alice' }).toBeObject();

// Exact type equality
type User = { id: number; name: string };
const user: User = { id: 1, name: 'Alice' };
expectTypeOf(user).toEqualTypeOf<User>();

// Type compatibility
expectTypeOf<number>().toMatchTypeOf<number | string>();
expectTypeOf<'admin' | 'user'>().toMatchTypeOf<string>();

// Negation
expectTypeOf('hello').not.toBeNumber();
expectTypeOf<string>().not.toEqualTypeOf<number>();

// Property testing
type Person = { name: string; age: number; email?: string };
expectTypeOf<Person>().toHaveProperty('name');
expectTypeOf<Person>().toHaveProperty('email');
expectTypeOf<Person>().toHaveProperty('name').toBeString();
expectTypeOf<Person>().toHaveProperty('age').toBeNumber();
```

### Function Type Testing

Specialized utilities for testing function signatures and behavior.

```typescript { .api }
// Function parameter testing
function add(a: number, b: number): number {
  return a + b;
}

expectTypeOf(add).parameter(0).toBeNumber();
expectTypeOf(add).parameter(1).toBeNumber();
expectTypeOf(add).parameters.toEqualTypeOf<[number, number]>();
expectTypeOf(add).returns.toBeNumber();

// Generic function testing
function identity<T>(value: T): T {
  return value;
}
expectTypeOf(identity<string>)
  .parameter(0)
  .toBeString();
expectTypeOf(identity<string>).returns.toBeString();

// Overloaded function testing
function overloaded(x: string): string;
function overloaded(x: number): number;
function overloaded(x: any): any {
  return x;
}

expectTypeOf(overloaded).parameter(0).toMatchTypeOf<string | number>();
```

### Promise and Async Type Testing

Test promise types and async function return types.

```typescript { .api }
// Promise type testing
const stringPromise: Promise<string> = Promise.resolve('hello');
expectTypeOf(stringPromise).resolves.toBeString();

const numberPromise: Promise<number> = Promise.resolve(42);
expectTypeOf(numberPromise).resolves.toBeNumber();

// Async function testing
async function fetchUser(): Promise<{ id: number; name: string }> {
  return { id: 1, name: 'Alice' };
}

expectTypeOf(fetchUser).returns.resolves.toEqualTypeOf<{
  id: number;
  name: string;
}>();
expectTypeOf(fetchUser).returns.resolves.toHaveProperty('id').toBeNumber();
```

### Array and Tuple Type Testing

Validate array types, tuple types, and their elements.

```typescript { .api }
// Array type testing
const numbers: number[] = [1, 2, 3];
expectTypeOf(numbers).toBeArray();
expectTypeOf(numbers).toEqualTypeOf<number[]>();

// Tuple type testing
const tuple: [string, number, boolean] = ['hello', 42, true];
expectTypeOf(tuple).toEqualTypeOf<[string, number, boolean]>();
expectTypeOf(tuple).toHaveLength<3>();

// Nested array testing
const matrix: number[][] = [
  [1, 2],
  [3, 4],
];
expectTypeOf(matrix).toBeArray();
expectTypeOf(matrix).toEqualTypeOf<number[][]>();
```

### Generic Type Testing

Test generic types, constraints, and type parameter relationships.

```typescript { .api }
// Generic type testing
type Container<T> = { value: T };
type StringContainer = Container<string>;

expectTypeOf<StringContainer>().toEqualTypeOf<{ value: string }>();
expectTypeOf<StringContainer>().toHaveProperty('value').toBeString();

// Conditional type testing
type IsString<T> = T extends string ? true : false;
expectTypeOf<IsString<'hello'>>().toEqualTypeOf<true>();
expectTypeOf<IsString<number>>().toEqualTypeOf<false>();

// Mapped type testing
type Partial<T> = { [K in keyof T]?: T[K] };
type PartialUser = Partial<{ name: string; age: number }>;
expectTypeOf<PartialUser>().toEqualTypeOf<{ name?: string; age?: number }>();
```

### Type Assertion Function

Runtime no-op function for type assertions in tests.

```typescript { .api }
/**
 * Assert that a value has a specific type (no-op at runtime)
 * @param value - Value to assert type for
 */
function assertType<T>(value: T): void;
```

**Usage Examples:**

```typescript
import { assertType } from 'vitest';

// Type assertion in tests
function processData(data: unknown) {
  if (typeof data === 'string') {
    // Assert that TypeScript correctly narrows the type
    assertType<string>(data);
    return data.toUpperCase();
  }

  if (Array.isArray(data)) {
    assertType<unknown[]>(data);
    return data.length;
  }

  throw new Error('Invalid data type');
}

// Test type guards
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

const value: unknown = 'hello';
if (isString(value)) {
  // Assert that type guard worked correctly
  assertType<string>(value);
  console.log(value.toUpperCase()); // Should compile without error
}
```

### Complex Type Testing Scenarios

Advanced patterns for testing complex type relationships.

```typescript { .api }
// Union type testing
type Status = 'pending' | 'completed' | 'failed';
expectTypeOf<Status>().toMatchTypeOf<string>();
expectTypeOf<Status>().not.toEqualTypeOf<string>();

// Intersection type testing
type Named = { name: string };
type Aged = { age: number };
type Person = Named & Aged;

expectTypeOf<Person>().toEqualTypeOf<{ name: string; age: number }>();
expectTypeOf<Person>().toHaveProperty('name').toBeString();
expectTypeOf<Person>().toHaveProperty('age').toBeNumber();

// Discriminated union testing
type Shape =
  | { type: 'circle'; radius: number }
  | { type: 'rectangle'; width: number; height: number };

expectTypeOf<Shape>().toHaveProperty('type');
expectTypeOf<Shape>()
  .toHaveProperty('type')
  .toMatchTypeOf<'circle' | 'rectangle'>();

// Template literal type testing
type EventName<T extends string> = `on${Capitalize<T>}`;
type ClickEvent = EventName<'click'>;
expectTypeOf<ClickEvent>().toEqualTypeOf<'onClick'>();

// Recursive type testing
type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

const jsonData: JSONValue = {
  name: 'Alice',
  age: 30,
  hobbies: ['reading', 'swimming'],
  address: { city: 'New York', zip: 10001 },
};

expectTypeOf(jsonData).toMatchTypeOf<JSONValue>();
```

### Type Testing Configuration

Configure TypeScript type checking behavior in tests.

```typescript { .api }
// vitest.config.ts
export default defineConfig({
  test: {
    typecheck: {
      /** Enable type checking */
      enabled: true,

      /** Only run type checking, skip test execution */
      only: false,

      /** TypeScript config file to use */
      tsconfig: './tsconfig.test.json',

      /** Files to include in type checking */
      include: ['src/**/*.test-d.ts', 'src/**/*.type-test.ts'],

      /** Files to exclude from type checking */
      exclude: ['**/*.js'],

      /** Ignore TypeScript source errors */
      ignoreSourceErrors: false,

      /** Allow JavaScript files */
      allowJs: false,
    },
  },
});
```

### Type Test File Organization

Organize type tests in dedicated files with `.test-d.ts` or `.type-test.ts` extensions.

```typescript { .api }
// user.type-test.ts
import { expectTypeOf } from 'vitest';
import type { User, CreateUserRequest, UserRepository } from './user';

// Test type definitions
expectTypeOf<User>().toEqualTypeOf<{
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}>();

// Test API types
expectTypeOf<CreateUserRequest>().toEqualTypeOf<{
  name: string;
  email: string;
}>();

// Test interface implementations
class MockUserRepository implements UserRepository {
  async findById(id: number): Promise<User | null> {
    return null;
  }

  async create(data: CreateUserRequest): Promise<User> {
    return {} as User;
  }
}

expectTypeOf<MockUserRepository>().toMatchTypeOf<UserRepository>();
```

### Error Type Testing

Test error types and exception handling type safety.

```typescript { .api }
// Error type testing
class CustomError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

expectTypeOf<CustomError>().toHaveProperty('code').toBeString();
expectTypeOf<CustomError>().toHaveProperty('message').toBeString();

// Result type testing
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

type UserResult = Result<User, CustomError>;

expectTypeOf<UserResult>().toHaveProperty('success').toBeBoolean();

// Test discriminated union narrowing
function handleResult(result: UserResult) {
  if (result.success) {
    assertType<{ success: true; data: User }>(result);
    expectTypeOf(result.data).toEqualTypeOf<User>();
  } else {
    assertType<{ success: false; error: CustomError }>(result);
    expectTypeOf(result.error).toEqualTypeOf<CustomError>();
  }
}
```
