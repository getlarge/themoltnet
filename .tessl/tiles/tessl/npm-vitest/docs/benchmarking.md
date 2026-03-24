# Benchmarking

Performance testing and benchmarking capabilities with statistical analysis and comparison features. Measure and compare code performance across different implementations.

## Capabilities

### Benchmark Definition

Define performance benchmarks with statistical measurement.

```typescript { .api }
/**
 * Define a benchmark test
 * @param name - Benchmark description
 * @param fn - Function to benchmark
 * @param options - Benchmark configuration options
 */
function bench(name: string, fn: BenchFunction, options?: BenchOptions): void;

/**
 * Benchmark function interface
 */
interface BenchFunction {
  (): void | Promise<void>;
}

/**
 * Benchmark configuration options
 */
interface BenchOptions {
  /** Number of iterations to run */
  iterations?: number;

  /** Time to run benchmark in milliseconds */
  time?: number;

  /** Warmup time before measurement in milliseconds */
  warmupTime?: number;

  /** Number of warmup iterations */
  warmupIterations?: number;

  /** Setup function run before each iteration */
  setup?: () => void | Promise<void>;

  /** Teardown function run after each iteration */
  teardown?: () => void | Promise<void>;
}
```

**Usage Examples:**

```typescript
import { bench } from 'vitest';

// Basic benchmark
bench('string concatenation', () => {
  let result = '';
  for (let i = 0; i < 1000; i++) {
    result += 'hello';
  }
});

// Benchmark with options
bench(
  'array operations',
  () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    arr.filter((x) => x % 2 === 0).map((x) => x * 2);
  },
  {
    iterations: 100,
    time: 1000,
    warmupTime: 500,
  },
);

// Async benchmark
bench(
  'async operation',
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  },
  {
    time: 2000,
    warmupTime: 200,
  },
);

// Benchmark with setup/teardown
bench(
  'database operations',
  () => {
    database.query('SELECT * FROM users');
  },
  {
    setup: () => {
      database.connect();
    },
    teardown: () => {
      database.disconnect();
    },
  },
);
```

### Benchmark Modifiers

Control benchmark execution with chainable modifiers.

```typescript { .api }
interface BenchmarkAPI {
  /** Skip this benchmark */
  skip: typeof bench;

  /** Only run this benchmark */
  only: typeof bench;

  /** Mark benchmark as todo */
  todo: typeof bench;

  /** Skip benchmark if condition is true */
  skipIf: (condition: boolean) => typeof bench;

  /** Run benchmark only if condition is true */
  runIf: (condition: boolean) => typeof bench;

  /** Run benchmark with different inputs */
  each<T>(
    cases: ReadonlyArray<T>,
  ): (name: string, fn: (args: T) => void | Promise<void>) => void;
}
```

**Usage Examples:**

```typescript
// Skip benchmarks conditionally
bench.skipIf(process.env.CI === 'true')('local only benchmark', () => {
  // Only runs locally, not in CI
  expensiveOperation();
});

// Run only specific benchmarks during development
bench.only('debugging this benchmark', () => {
  optimizedAlgorithm();
});

// Parametric benchmarks
bench.each([{ size: 100 }, { size: 1000 }, { size: 10000 }])(
  'array processing with $size items',
  ({ size }) => {
    const array = Array.from({ length: size }, (_, i) => i);
    array.sort((a, b) => b - a);
  },
);

// Todo benchmarks
bench.todo('implement faster sorting algorithm');
```

### Benchmark Results

Access benchmark execution results and statistics.

```typescript { .api }
/**
 * Benchmark task result
 */
interface BenchTaskResult extends TaskResult {
  /** Benchmark-specific result data */
  benchmark?: BenchmarkResult;
}

/**
 * Benchmark measurement results
 */
interface BenchmarkResult {
  /** Task name */
  name: string;

  /** Number of operations per second */
  hz: number;

  /** Minimum execution time */
  min: number;

  /** Maximum execution time */
  max: number;

  /** Mean execution time */
  mean: number;

  /** Variance in execution times */
  variance: number;

  /** Standard deviation */
  sd: number;

  /** Standard error of the mean */
  sem: number;

  /** Margin of error */
  moe: number;

  /** Relative margin of error */
  rme: number;

  /** Percentage of samples */
  p75: number;
  p99: number;
  p995: number;
  p999: number;

  /** Total samples collected */
  samples: number[];
}
```

**Usage Examples:**

```typescript
import { bench, afterAll } from 'vitest';

const results: BenchmarkResult[] = [];

bench('algorithm A', () => {
  algorithmA();
});

bench('algorithm B', () => {
  algorithmB();
});

afterAll(() => {
  // Compare results
  results.sort((a, b) => b.hz - a.hz);

  console.log('Performance ranking:');
  results.forEach((result, index) => {
    console.log(
      `${index + 1}. ${result.name}: ${result.hz.toFixed(2)} ops/sec`,
    );
    console.log(
      `   Mean: ${result.mean.toFixed(3)}ms ±${result.rme.toFixed(2)}%`,
    );
  });
});
```

### Benchmark Configuration

Global benchmark configuration and settings.

```typescript { .api }
/**
 * Benchmark configuration options
 */
interface BenchmarkUserOptions {
  /** Include pattern for benchmark files */
  include?: string[];

  /** Exclude pattern for benchmark files */
  exclude?: string[];

  /** Include source files for benchmarking */
  includeSource?: string[];

  /** Default benchmark options */
  options?: BenchOptions;

  /** Benchmark reporters */
  reporters?: BenchmarkReporter[];

  /** Output file for results */
  outputFile?: string;
}

/**
 * Benchmark reporter interface
 */
interface BenchmarkReporter {
  onInit?(suites: BenchmarkSuite[]): void;
  onStart?(suites: BenchmarkSuite[]): void;
  onUpdate?(task: BenchTask, result: BenchTaskResult): void;
  onFinish?(suites: BenchmarkSuite[]): void;
}

/**
 * Benchmark suite
 */
interface BenchmarkSuite {
  name: string;
  tasks: BenchTask[];
  result?: BenchmarkResult;
}

/**
 * Individual benchmark task
 */
interface BenchTask {
  name: string;
  fn: BenchFunction;
  options: BenchOptions;
  result?: BenchTaskResult;
}
```

**Usage Examples:**

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    benchmark: {
      include: ['src/**/*.bench.ts'],
      exclude: ['**/*.skip.bench.ts'],
      options: {
        iterations: 1000,
        time: 2000,
        warmupTime: 500,
      },
      reporters: ['default', 'json'],
      outputFile: './benchmark-results.json',
    },
  },
});

// Custom benchmark reporter
class CustomBenchmarkReporter implements BenchmarkReporter {
  onStart(suites: BenchmarkSuite[]) {
    console.log(`Starting ${suites.length} benchmark suites`);
  }

  onUpdate(task: BenchTask, result: BenchTaskResult) {
    if (result.benchmark) {
      console.log(`${task.name}: ${result.benchmark.hz.toFixed(2)} ops/sec`);
    }
  }

  onFinish(suites: BenchmarkSuite[]) {
    console.log('Benchmarking completed');

    // Generate summary report
    const allTasks = suites.flatMap((suite) => suite.tasks);
    const fastest = allTasks.reduce((fastest, task) =>
      task.result?.benchmark &&
      task.result.benchmark.hz > (fastest?.result?.benchmark?.hz || 0)
        ? task
        : fastest,
    );

    console.log(`Fastest: ${fastest?.name}`);
  }
}
```

### Benchmark Runners

Different benchmark execution strategies and runners.

```typescript { .api }
/**
 * Node.js benchmark runner
 */
class NodeBenchmarkRunner {
  constructor(options?: BenchmarkRunnerOptions);

  /** Run single benchmark */
  runBench(task: BenchTask): Promise<BenchTaskResult>;

  /** Run benchmark suite */
  runSuite(suite: BenchmarkSuite): Promise<void>;
}

interface BenchmarkRunnerOptions {
  /** Concurrent benchmark execution */
  concurrent?: boolean;

  /** Maximum concurrent benchmarks */
  maxConcurrency?: number;

  /** Timeout for individual benchmarks */
  timeout?: number;
}
```

**Usage Examples:**

```typescript
import { NodeBenchmarkRunner } from 'vitest/runners';

// Custom benchmark runner usage
const runner = new NodeBenchmarkRunner({
  concurrent: false,
  timeout: 30000,
});

const suite: BenchmarkSuite = {
  name: 'Performance Tests',
  tasks: [
    {
      name: 'fast operation',
      fn: () => fastFunction(),
      options: { iterations: 1000 },
    },
    {
      name: 'slow operation',
      fn: () => slowFunction(),
      options: { iterations: 100 },
    },
  ],
};

await runner.runSuite(suite);
```

### Benchmark Comparison

Compare multiple implementations and analyze performance differences.

```typescript { .api }
/**
 * Compare benchmark results
 */
interface BenchmarkComparison {
  /** Fastest benchmark */
  fastest: BenchmarkResult;

  /** Slowest benchmark */
  slowest: BenchmarkResult;

  /** Performance ratios */
  ratios: Map<string, number>;

  /** Statistical significance */
  significant: boolean;
}

/**
 * Generate comparison report
 */
function compareBenchmarks(results: BenchmarkResult[]): BenchmarkComparison;
```

**Usage Examples:**

```typescript
import { bench, describe } from 'vitest';

describe('sorting algorithms', () => {
  const data = Array.from({ length: 1000 }, () => Math.random());

  bench('bubble sort', () => {
    bubbleSort([...data]);
  });

  bench('quick sort', () => {
    quickSort([...data]);
  });

  bench('merge sort', () => {
    mergeSort([...data]);
  });

  bench('native sort', () => {
    [...data].sort((a, b) => a - b);
  });
});

// Results will show relative performance:
// native sort: 12,345 ops/sec
// quick sort: 8,765 ops/sec (1.4x slower)
// merge sort: 6,543 ops/sec (1.9x slower)
// bubble sort: 123 ops/sec (100x slower)
```

### Memory Benchmarking

Measure memory usage alongside performance metrics.

```typescript { .api }
/**
 * Memory benchmark options
 */
interface MemoryBenchOptions extends BenchOptions {
  /** Track memory usage */
  trackMemory?: boolean;

  /** Force garbage collection */
  forceGC?: boolean;
}

/**
 * Memory benchmark result
 */
interface MemoryBenchmarkResult extends BenchmarkResult {
  /** Memory usage statistics */
  memory?: {
    /** Peak memory usage in bytes */
    peak: number;

    /** Average memory usage */
    average: number;

    /** Memory allocated during test */
    allocated: number;

    /** Garbage collection count */
    gcCount: number;
  };
}
```

**Usage Examples:**

```typescript
import { bench } from 'vitest';

// Memory-aware benchmark
bench(
  'memory intensive operation',
  () => {
    const largeArray = new Array(100000)
      .fill(0)
      .map((_, i) => ({ id: i, data: 'x'.repeat(100) }));
    return largeArray.filter((item) => item.id % 2 === 0);
  },
  {
    trackMemory: true,
    forceGC: true,
    iterations: 50,
  },
);

// Results will include memory usage:
// memory intensive operation: 234 ops/sec
//   Memory: peak 45.2MB, avg 23.1MB, allocated 89.3MB
//   GC runs: 12
```

### CLI Integration

Run benchmarks from command line with specific options.

```typescript { .api }
/**
 * Benchmark CLI commands
 */
interface BenchmarkCLI {
  /** Run benchmarks */
  bench(patterns?: string[], options?: BenchmarkUserOptions): Promise<void>;

  /** Compare benchmark results */
  compare(baseline: string, current: string): Promise<void>;

  /** Generate benchmark report */
  report(resultsFile: string, format?: 'html' | 'json' | 'csv'): Promise<void>;
}
```

**Usage Examples:**

```bash
# Run all benchmarks
npx vitest bench

# Run specific benchmark files
npx vitest bench src/**/*.bench.ts

# Run with custom options
npx vitest bench --iterations=2000 --time=5000

# Compare results
npx vitest bench --compare baseline.json

# Generate HTML report
npx vitest bench --reporter=html --outputFile=report.html
```

**Programmatic CLI usage:**

```typescript
import { startVitest } from 'vitest/node';

// Run benchmarks programmatically
const vitest = await startVitest('benchmark', ['src/**/*.bench.ts'], {
  test: {
    benchmark: {
      iterations: 2000,
      reporters: ['json'],
      outputFile: 'results.json',
    },
  },
});

console.log('Benchmarks completed');
await vitest?.close();
```
