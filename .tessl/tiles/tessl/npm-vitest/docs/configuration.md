# Configuration

Configuration system for test environments, coverage, reporters, and build options. Integrates seamlessly with Vite configuration for unified project setup.

## Capabilities

### Configuration Functions

Define Vitest configuration with type safety and IntelliSense support.

```typescript { .api }
/**
 * Define Vitest configuration with type safety
 * @param config - Vitest configuration object
 * @returns Typed configuration object
 */
function defineConfig(config: UserConfig): UserConfig;

/**
 * Define project configuration for workspace
 * @param config - Project-specific configuration
 * @returns Typed project configuration
 */
function defineProject(config: ProjectConfig): ProjectConfig;

/**
 * Merge multiple configuration objects
 * @param configs - Configuration objects to merge
 * @returns Merged configuration
 */
function mergeConfig(...configs: UserConfig[]): UserConfig;
```

**Usage Examples:**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});

// Project-specific config
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'unit',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

### Core Configuration

Primary configuration options for test execution and behavior.

```typescript { .api }
interface UserConfig extends Omit<ViteConfig, 'test'> {
  /** Test-specific configuration */
  test?: TestConfig;
}

interface TestConfig {
  /** Test files to include */
  include?: string[];

  /** Test files to exclude */
  exclude?: string[];

  /** Test name patterns to include */
  includeSource?: string[];

  /** Test environment */
  environment?: BuiltinEnvironment | (string & {});

  /** Environment-specific options */
  environmentOptions?: EnvironmentOptions;

  /** Environment match patterns */
  environmentMatchGlobs?: [string, BuiltinEnvironment][];

  /** Test root directory */
  root?: string;

  /** Enable global test APIs */
  globals?: boolean;

  /** Pool for running tests */
  pool?: Pool;

  /** Pool-specific options */
  poolOptions?: PoolOptions;

  /** Test timeout in milliseconds */
  testTimeout?: number;

  /** Hook timeout in milliseconds */
  hookTimeout?: number;

  /** Teardown timeout in milliseconds */
  teardownTimeout?: number;

  /** Silent mode */
  silent?: boolean;

  /** Hide successful tests in output */
  hideSkippedTests?: boolean;

  /** Run tests sequentially */
  sequence?: SequenceOptions;

  /** Shuffle tests */
  shuffle?: boolean;

  /** Test retry count */
  retry?: number;

  /** Bail after N failures */
  bail?: number;
}

type BuiltinEnvironment = 'node' | 'jsdom' | 'happy-dom' | 'edge-runtime';
type Pool = 'forks' | 'threads' | 'vmForks' | 'vmThreads' | 'typescript';
```

**Usage Examples:**

```typescript
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['src/**/*.e2e.test.ts'],
    environment: 'jsdom',
    globals: true,
    testTimeout: 10000,
    hookTimeout: 5000,
    retry: 2,
    sequence: {
      shuffle: true,
    },
  },
});
```

### Environment Configuration

Test environment setup and options.

```typescript { .api }
interface EnvironmentOptions {
  /** jsdom-specific options */
  jsdom?: JSDOMOptions;

  /** happy-dom-specific options */
  'happy-dom'?: HappyDOMOptions;
}

interface JSDOMOptions {
  /** JSDOM constructor options */
  html?: string;
  url?: string;
  referrer?: string;
  contentType?: string;
  includeNodeLocations?: boolean;
  storageQuota?: number;
  resources?: 'usable' | 'disable';
  console?: boolean;
  virtualConsole?: any;
  beforeParse?: (window: any) => void;
  pretendToBeVisual?: boolean;
  userAgent?: string;
}

interface HappyDOMOptions {
  /** Happy DOM configuration */
  width?: number;
  height?: number;
  url?: string;
  settings?: {
    disableJavaScriptEvaluation?: boolean;
    disableJavaScriptFileLoading?: boolean;
    disableCSSFileLoading?: boolean;
    disableComputedStyleRendering?: boolean;
    enableFileSystemHttpRequests?: boolean;
    device?: {
      prefersColorScheme?: 'light' | 'dark';
      mediaType?: 'screen' | 'print';
    };
  };
}
```

**Usage Examples:**

```typescript
export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000',
        html: '<!DOCTYPE html><html><body></body></html>',
        resources: 'usable',
        beforeParse(window) {
          window.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
          };
        },
      },
    },
  },
});

// Happy DOM configuration
export default defineConfig({
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      'happy-dom': {
        width: 1024,
        height: 768,
        settings: {
          device: {
            prefersColorScheme: 'dark',
            mediaType: 'screen',
          },
        },
      },
    },
  },
});
```

### Pool Configuration

Worker pool configuration for test execution.

```typescript { .api }
interface PoolOptions {
  /** Threads pool options */
  threads?: {
    /** Number of threads */
    minThreads?: number;
    maxThreads?: number;

    /** Use Atomics for faster communication */
    useAtomics?: boolean;

    /** Thread isolation */
    isolate?: boolean;
  };

  /** Forks pool options */
  forks?: {
    /** Number of forks */
    minForks?: number;
    maxForks?: number;

    /** Fork isolation */
    isolate?: boolean;
  };

  /** VM threads pool options */
  vmThreads?: {
    /** Number of VM threads */
    minThreads?: number;
    maxThreads?: number;

    /** Use Atomics */
    useAtomics?: boolean;
  };

  /** VM forks pool options */
  vmForks?: {
    /** Number of VM forks */
    minForks?: number;
    maxForks?: number;
  };
}
```

**Usage Examples:**

```typescript
export default defineConfig({
  test: {
    pool: 'threads',
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 4,
        useAtomics: true,
        isolate: true,
      },
    },
  },
});

// Fork pool configuration
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,
        isolate: false,
      },
    },
  },
});
```

### Coverage Configuration

Code coverage setup and reporting options.

```typescript { .api }
interface CoverageOptions<
  T extends CoverageProviderName = CoverageProviderName,
> {
  /** Coverage provider */
  provider?: T;

  /** Enable coverage */
  enabled?: boolean;

  /** Files to include in coverage */
  include?: string[];

  /** Files to exclude from coverage */
  exclude?: string[];

  /** Coverage thresholds */
  thresholds?: {
    lines?: number;
    functions?: number;
    branches?: number;
    statements?: number;
    perFile?: boolean;
    autoUpdate?: boolean;
  };

  /** Coverage reporters */
  reporter?: CoverageReporter | CoverageReporter[];

  /** Reports directory */
  reportsDirectory?: string;

  /** Report on each test file */
  reportOnFailure?: boolean;

  /** Allow external files */
  allowExternal?: boolean;

  /** Skip coverage if no tests are found */
  skipFull?: boolean;

  /** Provider-specific options */
  providerOptions?: T extends 'v8'
    ? CoverageV8Options
    : CoverageIstanbulOptions;
}

type CoverageProviderName = 'v8' | 'istanbul' | 'custom';
type CoverageReporter =
  | 'text'
  | 'text-summary'
  | 'html'
  | 'json'
  | 'json-summary'
  | 'lcov'
  | 'clover'
  | 'cobertura';

interface CoverageV8Options {
  /** All V8 coverage options */
  all?: boolean;
}

interface CoverageIstanbulOptions {
  /** Watermarks for coverage levels */
  watermarks?: {
    statements?: [number, number];
    lines?: [number, number];
    functions?: [number, number];
    branches?: [number, number];
  };
}
```

**Usage Examples:**

```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        perFile: true,
      },
    },
  },
});

// Istanbul provider
export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      reporter: ['lcov', 'text-summary'],
      providerOptions: {
        watermarks: {
          statements: [50, 80],
          functions: [50, 80],
          branches: [50, 80],
          lines: [50, 80],
        },
      },
    },
  },
});
```

### Reporter Configuration

Test result reporting configuration.

```typescript { .api }
interface TestConfig {
  /** Test reporters */
  reporter?: Reporter | Reporter[];

  /** Reporter options */
  outputFile?: string | Record<string, string>;
}

type Reporter =
  | 'default'
  | 'verbose'
  | 'dot'
  | 'json'
  | 'junit'
  | 'tap'
  | 'hanging-process'
  | 'github-actions'
  | 'html'
  | CustomReporter;

interface CustomReporter {
  onInit?(ctx: Vitest): void;
  onPathsCollected?(paths: string[]): void;
  onCollected?(files: File[]): void;
  onFinished?(files: File[], errors: unknown[]): void;
  onTaskUpdate?(packs: TaskResultPack[]): void;
  onTestRemoved?(trigger?: string): void;
  onWatcherStart?(files: File[], errors: unknown[]): void;
  onWatcherRerun?(files: string[], trigger?: string): void;
  onServerRestart?(reason?: string): void;
  onUserConsoleLog?(log: UserConsoleLog): void;
}
```

**Usage Examples:**

```typescript
export default defineConfig({
  test: {
    reporter: ['default', 'json', 'junit'],
    outputFile: {
      json: './test-results.json',
      junit: './junit.xml',
    },
  },
});

// Custom reporter
const customReporter: CustomReporter = {
  onFinished(files, errors) {
    console.log(
      `Tests completed: ${files.length} files, ${errors.length} errors`,
    );
  },
};

export default defineConfig({
  test: {
    reporter: [customReporter],
  },
});
```

### Watch Mode Configuration

File watching and test re-execution options.

```typescript { .api }
interface TestConfig {
  /** Watch mode configuration */
  watch?: boolean;

  /** Watch options */
  watchExclude?: string[];

  /** Ignore changes in node_modules */
  watchIgnore?: string[];

  /** Force exit after tests */
  forceRerunTriggers?: string[];
}
```

**Usage Examples:**

```typescript
export default defineConfig({
  test: {
    watch: true,
    watchExclude: ['**/node_modules/**', '**/dist/**'],
    forceRerunTriggers: ['**/vitest.config.*', '**/vite.config.*'],
  },
});
```

### Setup Files

Test setup and teardown file configuration.

```typescript { .api }
interface TestConfig {
  /** Setup files to run before tests */
  setupFiles?: string | string[];

  /** Global setup files */
  globalSetup?: string | string[];

  /** Teardown files */
  teardownTimeout?: number;
}
```

**Usage Examples:**

```typescript
export default defineConfig({
  test: {
    setupFiles: ['./src/test/setup.ts'],
    globalSetup: ['./src/test/global-setup.ts'],
    teardownTimeout: 10000,
  },
});

// Setup file example
// src/test/setup.ts
import { beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

beforeEach(() => {
  cleanup();
});
```

### Workspace Configuration

Multi-project workspace configuration.

```typescript { .api }
interface UserWorkspaceConfig {
  /** Workspace projects */
  projects?: (string | ProjectConfig)[];

  /** Workspace root */
  root?: string;
}

interface ProjectConfig extends TestConfig {
  /** Project name */
  name?: string;

  /** Project root directory */
  root?: string;
}
```

**Usage Examples:**

```typescript
// vitest.workspace.ts
export default defineWorkspace([
  'packages/*/vitest.config.ts',
  {
    test: {
      name: 'unit',
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'integration',
      include: ['tests/**/*.test.ts'],
      environment: 'jsdom',
    },
  },
]);
```

### TypeScript Configuration

TypeScript checking and compilation options.

```typescript { .api }
interface TestConfig {
  /** TypeScript type checking */
  typecheck?: TypecheckConfig;
}

interface TypecheckConfig {
  /** Enable type checking */
  enabled?: boolean;

  /** Only type check, don't run tests */
  only?: boolean;

  /** TypeScript config file */
  tsconfig?: string;

  /** Files to type check */
  include?: string[];

  /** Files to exclude from type checking */
  exclude?: string[];

  /** Ignore TypeScript errors */
  ignoreSourceErrors?: boolean;

  /** Allow JavaScript files */
  allowJs?: boolean;
}
```

**Usage Examples:**

```typescript
export default defineConfig({
  test: {
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.test.json',
      include: ['src/**/*.ts', 'tests/**/*.ts'],
      exclude: ['**/*.js'],
      ignoreSourceErrors: false,
    },
  },
});
```

## Common Configuration Patterns

```typescript { .api }
// Full featured configuration example
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,tsx}'],
    exclude: ['src/**/*.e2e.test.ts'],
    testTimeout: 10000,
    hookTimeout: 5000,
    retry: 2,
    pool: 'threads',
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 4,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    reporter: ['default', 'json'],
    outputFile: {
      json: './test-results.json',
    },
  },
});
```
