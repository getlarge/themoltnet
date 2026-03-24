# Node.js APIs

Server-side APIs for programmatic test execution, custom reporters, coverage providers, and CLI integration. Available through the `vitest/node` export path.

## Capabilities

### Core Vitest Class

Main test runner class for programmatic test execution.

```typescript { .api }
/**
 * Main Vitest test runner
 */
class Vitest {
  constructor(mode: VitestRunMode, options: UserConfig);

  /** Start test execution */
  start(filters?: string[]): Promise<void>;

  /** Close and cleanup resources */
  close(): Promise<void>;

  /** Cancel current test run */
  cancelCurrentRun(reason?: CancelReason): Promise<void>;

  /** Re-run tests */
  rerunFiles(files?: string[], trigger?: string): Promise<void>;

  /** Update snapshots */
  updateSnapshot(files?: string[]): Promise<void>;

  /** Get test results */
  state: StateManager;

  /** Configuration */
  config: ResolvedConfig;

  /** Server instance */
  server: ViteDevServer;

  /** Coverage provider */
  coverageProvider?: CoverageProvider;

  /** Reporter */
  reporter: Reporter;

  /** Project manager */
  projects: WorkspaceProject[];
}

type VitestRunMode = 'test' | 'benchmark' | 'typecheck';
```

**Usage Examples:**

```typescript
import { createVitest } from 'vitest/node';

// Create and run tests programmatically
const vitest = await createVitest('test', {
  test: {
    include: ['src/**/*.test.ts'],
    reporter: 'json',
  },
});

await vitest.start();
console.log('Tests completed');
await vitest.close();
```

### Factory Functions

Convenience functions for creating Vitest instances.

```typescript { .api }
/**
 * Create Vitest instance
 * @param mode - Test run mode
 * @param options - Configuration options
 * @param viteOverrides - Vite-specific overrides
 * @returns Promise resolving to Vitest instance
 */
function createVitest(
  mode: VitestRunMode,
  options: UserConfig,
  viteOverrides?: ViteConfig,
): Promise<Vitest>;

/**
 * Start Vitest from CLI
 * @param mode - Test run mode
 * @param cliFilters - File patterns from CLI
 * @param options - Configuration options
 * @param viteOverrides - Vite-specific overrides
 * @returns Promise resolving to Vitest instance or undefined if cancelled
 */
function startVitest(
  mode: VitestRunMode,
  cliFilters?: string[],
  options?: UserConfig,
  viteOverrides?: ViteConfig,
): Promise<Vitest | undefined>;
```

**Usage Examples:**

```typescript
import { startVitest } from 'vitest/node';

// Start tests like CLI would
const vitest = await startVitest('test', ['src/**/*.spec.ts'], {
  test: {
    reporter: 'verbose',
    coverage: {
      enabled: true,
      provider: 'v8',
    },
  },
});

if (vitest) {
  console.log(
    `Tests completed with ${vitest.state.getCountOfFailedTests()} failures`,
  );
}
```

### CLI Integration

CLI argument parsing and command execution.

```typescript { .api }
/**
 * Parse CLI arguments
 * @param argv - Command line arguments
 * @param config - Base configuration
 * @returns Parsed CLI options
 */
function parseCLI(
  argv: string[],
  config?: UserConfig,
): {
  filter: string[];
  options: UserConfig;
  mode: VitestRunMode;
};

/**
 * Vitest CLI commands
 */
interface VitestCLI {
  run(files?: string[], options?: UserConfig): Promise<void>;
  watch(files?: string[], options?: UserConfig): Promise<void>;
  related(files?: string[], options?: UserConfig): Promise<void>;
  typecheck(files?: string[], options?: UserConfig): Promise<void>;
}
```

**Usage Examples:**

```typescript
import { parseCLI } from 'vitest/node';

// Parse command line arguments
const { filter, options, mode } = parseCLI(process.argv.slice(2), {
  test: { environment: 'node' },
});

console.log(`Running in ${mode} mode with filters:`, filter);
console.log('Configuration:', options);
```

### Reporter System

Built-in reporters and custom reporter interfaces.

```typescript { .api }
/**
 * Base reporter class for custom reporters
 */
abstract class BaseReporter implements Reporter {
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

/**
 * Default console reporter
 */
class DefaultReporter extends BaseReporter {
  constructor(options?: DefaultReporterOptions);
}

/**
 * Verbose reporter with detailed output
 */
class VerboseReporter extends DefaultReporter {
  constructor(options?: VerboseReporterOptions);
}

/**
 * JSON reporter for machine-readable output
 */
class JsonReporter implements Reporter {
  constructor(options?: JsonReporterOptions);
}

/**
 * JUnit XML reporter
 */
class JUnitReporter implements Reporter {
  constructor(options?: JUnitReporterOptions);
}

/**
 * TAP (Test Anything Protocol) reporter
 */
class TAPReporter implements Reporter {
  constructor(options?: TAPReporterOptions);
}

interface Reporter {
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
import { BaseReporter } from 'vitest/node';

// Custom reporter
class CustomReporter extends BaseReporter {
  onInit(ctx: Vitest) {
    console.log(`Starting tests with ${ctx.projects.length} projects`);
  }

  onFinished(files: File[], errors: unknown[]) {
    const passed = files.filter((f) => f.result?.state === 'pass').length;
    const failed = files.filter((f) => f.result?.state === 'fail').length;

    console.log(`✅ ${passed} passed, ❌ ${failed} failed`);

    if (errors.length > 0) {
      console.error('Errors:', errors);
    }
  }

  onTaskUpdate(packs: TaskResultPack[]) {
    packs.forEach((pack) => {
      if (pack[1]?.state === 'fail') {
        console.log(`❌ ${pack[1].name}`);
      }
    });
  }
}

// Use custom reporter
export default defineConfig({
  test: {
    reporter: [new CustomReporter()],
  },
});
```

### Coverage System

Coverage provider interfaces and built-in providers.

```typescript { .api }
/**
 * Base coverage provider
 */
abstract class BaseCoverageProvider implements CoverageProvider {
  abstract name: string;
  abstract initialize(ctx: Vitest): Promise<void>;
  abstract resolveOptions(): ResolvedCoverageOptions;
  abstract generateCoverage(context: CoverageContext): Promise<CoverageResult>;
  abstract clean(clean?: boolean): void;
  abstract onAfterSuiteRun(meta: AfterSuiteRunMeta): void;
  abstract reportCoverage(context: ReportContext): Promise<void>;
}

/**
 * Coverage provider interface
 */
interface CoverageProvider {
  name: string;
  initialize(ctx: Vitest): Promise<void>;
  resolveOptions(): ResolvedCoverageOptions;
  generateCoverage(context?: CoverageContext): Promise<CoverageResult>;
  clean(clean?: boolean): void;
  onAfterSuiteRun(meta: AfterSuiteRunMeta): void;
  reportCoverage(context?: ReportContext): Promise<void>;
}

interface CoverageContext {
  files: string[];
  allTestsRun?: boolean;
}

interface CoverageResult {
  coverage: any;
  reportContext: ReportContext;
}

interface ReportContext {
  coverage: any;
  options: ResolvedCoverageOptions;
  packages: Record<string, unknown>;
}
```

**Usage Examples:**

```typescript
import { BaseCoverageProvider } from 'vitest/node';

// Custom coverage provider
class CustomCoverageProvider extends BaseCoverageProvider {
  name = 'custom';

  async initialize(ctx: Vitest) {
    console.log('Initializing custom coverage provider');
  }

  resolveOptions() {
    return {
      enabled: true,
      provider: 'custom',
      // ... other options
    };
  }

  async generateCoverage(context: CoverageContext) {
    // Generate coverage data
    return {
      coverage: {},
      reportContext: {
        coverage: {},
        options: this.resolveOptions(),
        packages: {},
      },
    };
  }

  clean() {
    // Cleanup coverage files
  }

  onAfterSuiteRun(meta: AfterSuiteRunMeta) {
    // Process suite results
  }

  async reportCoverage(context: ReportContext) {
    // Generate coverage reports
    console.log('Generating coverage reports');
  }
}
```

### Workspace Management

Project and workspace management for multi-project setups.

```typescript { .api }
/**
 * Workspace project
 */
class WorkspaceProject {
  constructor(path: string, ctx: Vitest);

  /** Project name */
  name: string;

  /** Project configuration */
  config: ResolvedConfig;

  /** Project Vite server */
  server: ViteDevServer;

  /** Browser provider (if applicable) */
  browser?: any;

  /** Project root path */
  path: string;

  /** Run tests in this project */
  runTests(files?: string[]): Promise<void>;

  /** Close project resources */
  close(): Promise<void>;

  /** Check if file belongs to project */
  isTargetFile(id: string): boolean;

  /** Get relative file path */
  getRelativeFilePath(file: string): string;
}

/**
 * Workspace manager
 */
class Workspace {
  constructor(ctx: Vitest);

  /** All projects in workspace */
  projects: WorkspaceProject[];

  /** Get project by name */
  getProjectByName(name: string): WorkspaceProject | undefined;

  /** Get project for file */
  getProjectForFile(file: string): WorkspaceProject;

  /** Close all projects */
  close(): Promise<void>;
}
```

**Usage Examples:**

```typescript
import { createVitest } from 'vitest/node';

const vitest = await createVitest('test', {
  // Workspace configuration
});

// Access projects
vitest.projects.forEach((project) => {
  console.log(`Project: ${project.name} at ${project.path}`);
});

// Run specific project
const project = vitest.projects.find((p) => p.name === 'unit');
if (project) {
  await project.runTests(['src/**/*.test.ts']);
}
```

### Test Sequencer

Control test execution order and scheduling.

```typescript { .api }
/**
 * Base test sequencer
 */
abstract class TestSequencer {
  abstract sequence(files: WorkspaceSpec[]): Promise<WorkspaceSpec[]>;
  abstract shardFiles?(
    files: WorkspaceSpec[],
    shard: TestShard,
  ): Promise<WorkspaceSpec[]>;
}

/**
 * Default sequencer (alphabetical order)
 */
class BaseSequencer extends TestSequencer {
  async sequence(files: WorkspaceSpec[]): Promise<WorkspaceSpec[]>;
  async shardFiles(
    files: WorkspaceSpec[],
    shard: TestShard,
  ): Promise<WorkspaceSpec[]>;
}

/**
 * Random sequencer
 */
class RandomSequencer extends TestSequencer {
  constructor(options?: { seed?: number });
  async sequence(files: WorkspaceSpec[]): Promise<WorkspaceSpec[]>;
}

interface TestShard {
  index: number;
  count: number;
}

interface WorkspaceSpec {
  file: string;
  project: WorkspaceProject;
}
```

**Usage Examples:**

```typescript
import { RandomSequencer } from 'vitest/node';

// Custom sequencer
class PrioritySequencer extends TestSequencer {
  async sequence(files: WorkspaceSpec[]) {
    // Sort by priority: unit tests first, then integration
    return files.sort((a, b) => {
      const aIsUnit = a.file.includes('unit');
      const bIsUnit = b.file.includes('unit');

      if (aIsUnit && !bIsUnit) return -1;
      if (!aIsUnit && bIsUnit) return 1;
      return a.file.localeCompare(b.file);
    });
  }
}

export default defineConfig({
  test: {
    sequence: {
      sequencer: new PrioritySequencer(),
    },
  },
});
```

### Utility Functions

Helper functions for working with test results and tasks.

```typescript { .api }
/**
 * Check if task failed
 * @param task - Task to check
 * @returns True if task failed
 */
function hasFailed(task: Task): boolean;

/**
 * Get full task name including parent suite names
 * @param task - Task to get name for
 * @returns Full qualified task name
 */
function getFullName(task: Task): string;

/**
 * Get all test tasks from a suite
 * @param suite - Suite to extract tests from
 * @returns Array of test tasks
 */
function getTests(suite: Suite): Test[];

/**
 * Get all tasks (tests and suites) from a suite
 * @param suite - Suite to extract tasks from
 * @returns Array of all tasks
 */
function getTasks(suite: Suite): Task[];

/**
 * Get root tasks from files
 * @param files - Files to extract root tasks from
 * @returns Array of root tasks
 */
function getRootTasks(files: File[]): Task[];
```

**Usage Examples:**

```typescript
import { hasFailed, getFullName, getTests } from 'vitest/node';

// Custom reporter using utilities
class DetailedReporter extends BaseReporter {
  onFinished(files: File[]) {
    files.forEach((file) => {
      const tests = getTests(file);
      const failed = tests.filter(hasFailed);

      if (failed.length > 0) {
        console.log(`\n${file.name}:`);
        failed.forEach((test) => {
          console.log(`  ❌ ${getFullName(test)}`);
        });
      }
    });
  }
}
```

### State Management

Access and monitor test execution state.

```typescript { .api }
/**
 * Test state manager
 */
class StateManager {
  /** Get files map */
  filesMap: Map<string, File>;

  /** Get all files */
  getFiles(): File[];

  /** Get file by path */
  getFileByPath(path: string): File | undefined;

  /** Get failed tests count */
  getCountOfFailedTests(): number;

  /** Get unhandled errors */
  getUnhandledErrors(): unknown[];

  /** Check if tests were cancelled */
  isCancelled: boolean;
}

interface File extends Suite {
  /** File path */
  filepath: string;

  /** File collection errors */
  collectDuration?: number;

  /** Environment setup duration */
  setupDuration?: number;

  /** Project reference */
  project: WorkspaceProject;
}
```

**Usage Examples:**

```typescript
import { createVitest } from 'vitest/node';

const vitest = await createVitest('test');
await vitest.start();

// Access test state
const failedCount = vitest.state.getCountOfFailedTests();
const allFiles = vitest.state.getFiles();
const errors = vitest.state.getUnhandledErrors();

console.log(`Failed tests: ${failedCount}`);
console.log(`Total files: ${allFiles.length}`);
console.log(`Unhandled errors: ${errors.length}`);

await vitest.close();
```
