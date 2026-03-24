# Reporting & Output

Multiple reporting formats and customizable output options for different workflows and CI/CD integration. Knip provides built-in reporters and supports custom reporter development.

## Capabilities

### Reporter Interface

Core interface for creating custom reporters.

```typescript { .api }
/**
 * Reporter function interface
 * @param options - Reporter options containing issues and metadata
 */
type Reporter = (options: ReporterOptions) => void;

interface ReporterOptions {
  /** Report configuration indicating which issue types to include */
  report: Report;
  /** All detected issues organized by type */
  issues: Issues;
  /** Issue counters by type */
  counters: Counters;
  /** Hints about tagged exports */
  tagHints: Set<TagHint>;
  /** Configuration improvement suggestions */
  configurationHints: Set<ConfigurationHint>;
  /** Whether to disable configuration hints */
  isDisableConfigHints: boolean;
  /** Treat configuration hints as errors */
  isTreatConfigHintsAsErrors: boolean;
  /** Current working directory */
  cwd: string;
  /** Production mode flag */
  isProduction: boolean;
  /** Show progress information */
  isShowProgress: boolean;
  /** Custom options passed to reporter */
  options: string;
  /** Options for preprocessors */
  preprocessorOptions: string;
  /** List of included workspace directories */
  includedWorkspaceDirs: string[];
  /** Configuration file path */
  configFilePath?: string;
}

interface Report {
  files: boolean;
  dependencies: boolean;
  devDependencies: boolean;
  optionalPeerDependencies: boolean;
  unlisted: boolean;
  binaries: boolean;
  unresolved: boolean;
  exports: boolean;
  types: boolean;
  nsExports: boolean;
  nsTypes: boolean;
  duplicates: boolean;
  enumMembers: boolean;
  classMembers: boolean;
}
```

**Usage Examples:**

### Using Built-in Reporters

```bash
# Default symbols reporter
npx knip

# JSON output
npx knip --reporter json

# Multiple reporters
npx knip --reporter symbols --reporter json

# Compact output
npx knip --reporter compact

# Markdown output for documentation
npx knip --reporter markdown
```

### Built-in Reporters

Knip includes several built-in reporters for different use cases.

```typescript { .api }
/** Available built-in reporters */
type BuiltInReporter =
  | 'symbols' // Default terminal output with symbols
  | 'compact' // Compact terminal output
  | 'json' // JSON format for tools
  | 'markdown' // Markdown format for documentation
  | 'codeowners' // GitHub CODEOWNERS format
  | 'codeclimate' // Code Climate format for CI
  | 'disclosure'; // Issue disclosure summary
```

### Symbols Reporter

Default reporter with symbol-based output and color coding.

```typescript { .api }
/**
 * Default symbols reporter
 * @param options - Reporter options
 */
function symbolsReporter(options: ReporterOptions): void;
```

**Output Example:**

```
✂️  Unused files (2)
src/utils/unused-helper.ts
test/fixtures/old-test.ts

✂️  Unused dependencies (3)
lodash (devDependencies)
moment (dependencies)
@types/unused (devDependencies)

✂️  Unused exports (5)
src/api.ts:
  • deprecatedFunction
  • InternalType

src/utils.ts:
  • helperFunction
  • UtilityClass
  • CONSTANT_VALUE
```

### JSON Reporter

Machine-readable JSON output for tool integration.

```typescript { .api }
/**
 * JSON reporter for machine-readable output
 * @param options - Reporter options
 */
function jsonReporter(options: ReporterOptions): void;

interface JsonOutput {
  files: string[];
  issues: {
    [issueType: string]: {
      [filePath: string]: Array<{
        symbol: string;
        symbolType?: string;
        parentSymbol?: string;
        line?: number;
        col?: number;
        pos?: number;
      }>;
    };
  };
  counters: Record<string, number>;
  rules: Record<string, string>;
  configurationHints?: ConfigurationHint[];
}
```

**Usage Examples:**

```bash
# Output JSON to file
npx knip --reporter json > knip-results.json

# Process with jq
npx knip --reporter json | jq '.counters.total'
```

### Compact Reporter

Minimal output format for CI environments.

```typescript { .api }
/**
 * Compact reporter for minimal output
 * @param options - Reporter options
 */
function compactReporter(options: ReporterOptions): void;
```

**Output Example:**

```
src/unused.ts: unused export "helper"
src/api.ts: unused export "oldFunction", "InternalType"
package.json: unused dependency "lodash"
Total: 4 issues
```

### Markdown Reporter

Markdown format suitable for documentation and pull request comments.

```typescript { .api }
/**
 * Markdown reporter for documentation
 * @param options - Reporter options
 */
function markdownReporter(options: ReporterOptions): void;
```

**Output Example:**

```markdown
# Knip Report

## Unused Files (2)

- `src/utils/unused-helper.ts`
- `test/fixtures/old-test.ts`

## Unused Dependencies (3)

- `lodash` (devDependencies)
- `moment` (dependencies)
- `@types/unused` (devDependencies)

## Unused Exports (5)

### `src/api.ts`

- `deprecatedFunction`
- `InternalType`

### `src/utils.ts`

- `helperFunction`
- `UtilityClass`
- `CONSTANT_VALUE`
```

### Code Climate Reporter

Code Climate format for CI integration and code quality tracking.

```typescript { .api }
/**
 * Code Climate reporter for CI integration
 * @param options - Reporter options
 */
function codeclimateReporter(options: ReporterOptions): void;

interface CodeClimateIssue {
  type: 'issue';
  check_name: string;
  description: string;
  categories: string[];
  location: {
    path: string;
    lines?: {
      begin: number;
      end: number;
    };
  };
  severity: 'minor' | 'major' | 'critical';
  fingerprint: string;
}
```

### CODEOWNERS Reporter

Generates GitHub CODEOWNERS format showing issue ownership.

```typescript { .api }
/**
 * CODEOWNERS reporter for GitHub integration
 * @param options - Reporter options
 */
function codeownersReporter(options: ReporterOptions): void;
```

### Custom Reporter Development

Create custom reporters for specific workflows.

```typescript { .api }
/**
 * Example custom reporter
 */
const customReporter: Reporter = (options) => {
  const { issues, counters, cwd } = options;

  // Custom reporting logic
  console.log(`Custom Report for ${cwd}`);
  console.log(`Total issues: ${counters.total}`);

  // Process specific issue types
  for (const [filePath, fileIssues] of Object.entries(issues.exports)) {
    console.log(`File: ${filePath}`);
    for (const [symbol, issue] of Object.entries(fileIssues)) {
      console.log(`  - Unused export: ${symbol} (line ${issue.line})`);
    }
  }

  // Add custom metadata
  console.log(`Report generated at ${new Date().toISOString()}`);
};

// Register custom reporter
import { runReporters } from 'knip';

await runReporters(['custom'], reporterOptions);
```

### Reporter Options

Customize reporter behavior with options.

```typescript { .api }
/**
 * Run reporters with custom options
 * @param reporters - List of reporter names
 * @param options - Reporter options
 */
function runReporters(
  reporters: string[],
  options: ReporterOptions,
): Promise<void>;

/**
 * Parse reporter options from JSON string
 * @param optionsString - JSON string with options
 * @returns Parsed options object
 */
function parseReporterOptions(optionsString: string): Record<string, any>;
```

**Usage Examples:**

```bash
# Pass options to reporters
npx knip --reporter json --reporter-options '{"indent":2,"sort":true}'

# Compact reporter with custom separator
npx knip --reporter compact --reporter-options '{"separator":"|"}'
```

### Preprocessors

Transform reporter data before output.

```typescript { .api }
/**
 * Preprocessor function interface
 * @param options - Original reporter options
 * @returns Modified reporter options
 */
type Preprocessor = (options: ReporterOptions) => ReporterOptions;

/**
 * Run preprocessors on reporter data
 * @param preprocessors - List of preprocessor names
 * @param options - Original reporter options
 * @returns Modified reporter options
 */
function runPreprocessors(
  preprocessors: string[],
  options: ReporterOptions,
): Promise<ReporterOptions>;
```

**Usage Examples:**

```bash
# Apply preprocessors before reporting
npx knip --preprocessor sort --preprocessor filter --reporter json

# Pass options to preprocessors
npx knip --preprocessor-options '{"filter":{"minSeverity":"error"}}'
```

### Integration Examples

Common integration patterns for different workflows.

**GitHub Actions:**

```yaml
- name: Run Knip
  run: |
    npx knip --reporter json > knip-results.json
    npx knip --reporter markdown >> $GITHUB_STEP_SUMMARY
```

**CI/CD with Code Climate:**

```bash
# Export Code Climate format
npx knip --reporter codeclimate > codeclimate-knip.json
```

**Pull Request Comments:**

```bash
# Generate markdown for PR comment
npx knip --reporter markdown > knip-report.md
```

**Custom Dashboard Integration:**

```typescript
import { main } from 'knip';

const results = await main({ cwd: process.cwd() });

// Send to custom dashboard
await fetch('/api/code-analysis', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    project: 'my-app',
    timestamp: Date.now(),
    issues: results.issues,
    counters: results.counters,
  }),
});
```
