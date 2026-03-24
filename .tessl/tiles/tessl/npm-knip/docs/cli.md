# CLI Usage

Comprehensive command-line interface with extensive options for analysis, fixing, and workflow integration. The CLI provides access to all Knip functionality with detailed configuration options.

## Capabilities

### Basic Commands

Core CLI commands for different analysis modes.

```bash { .api }
# Basic analysis of current project
knip

# Analyze with specific configuration file
knip --config knip.json
knip -c knip.config.js

# Analyze with TypeScript configuration
knip --tsConfig tsconfig.json
knip -t tsconfig.build.json

# Production analysis only (no test files, devDependencies)
knip --production

# Strict mode (only direct dependencies)
knip --strict

# Analyze single workspace
knip --workspace packages/frontend
knip -W packages/backend

# Run from different directory
knip --directory /path/to/project

# Show help
knip --help
knip -h

# Show version
knip --version
knip -V
```

### Analysis Options

Control what gets analyzed and how.

```bash { .api }
# Enable caching for faster repeated runs
knip --cache

# Specify cache location
knip --cache-location node_modules/.cache/knip-custom

# Watch mode for continuous analysis
knip --watch

# Don't use .gitignore files
knip --no-gitignore

# Include type definitions from external dependencies
knip --include-libs

# Include entry exports in unused exports report
knip --include-entry-exports

# Isolate workspaces into separate programs
knip --isolate-workspaces
```

### Issue Type Filtering

Control which types of issues are reported.

```bash { .api }
# Include only specific issue types (can be repeated)
knip --include dependencies
knip --include dependencies,exports,files
knip --include dependencies --include exports

# Exclude specific issue types (can be repeated)
knip --exclude types
knip --exclude types,classMembers
knip --exclude types --exclude classMembers

# Shortcut for dependency-related issues
knip --dependencies
# Equivalent to: --include dependencies,unlisted,binaries,unresolved

# Shortcut for export-related issues
knip --exports
# Equivalent to: --include exports,nsExports,classMembers,types,nsTypes,enumMembers,duplicates

# Shortcut for unused files only
knip --files
# Equivalent to: --include files
```

**Available Issue Types:**

- `files` - Unused files
- `dependencies` - Unused dependencies
- `devDependencies` - Unused devDependencies
- `optionalPeerDependencies` - Referenced optional peerDependencies
- `unlisted` - Unlisted dependencies
- `binaries` - Unlisted binaries
- `unresolved` - Unresolved imports
- `exports` - Unused exports
- `nsExports` - Exports in used namespace
- `types` - Unused exported types
- `nsTypes` - Exported types in used namespace
- `enumMembers` - Unused exported enum members
- `classMembers` - Unused exported class members
- `duplicates` - Duplicate exports

### Fixing Options

Automatically fix detected issues.

```bash { .api }
# Fix all fixable issues
knip --fix

# Fix only specific issue types
knip --fix-type exports
knip --fix-type dependencies,exports
knip --fix-type exports --fix-type types

# Allow Knip to remove files (dangerous!)
knip --allow-remove-files

# Format files after fixing
knip --format
```

**Fixable Issue Types:**

- Unused imports and exports
- Unused variable declarations
- Unused dependencies in package.json
- Some unused files (with `--allow-remove-files`)

### Output and Reporting

Control output format and verbosity.

```bash { .api }
# Select reporter (can be repeated for multiple outputs)
knip --reporter symbols        # Default terminal output
knip --reporter compact        # Compact terminal output
knip --reporter json          # JSON format
knip --reporter markdown      # Markdown format
knip --reporter codeowners    # GitHub CODEOWNERS format
knip --reporter codeclimate   # Code Climate format
knip --reporter disclosure    # Issue summary

# Multiple reporters
knip --reporter json --reporter markdown

# Pass options to reporters (JSON format)
knip --reporter json --reporter-options '{"indent":2,"sort":true}'

# Don't show dynamic progress updates
knip --no-progress
knip -n

# Suppress configuration hints
knip --no-config-hints

# Treat configuration hints as errors (exit code 1)
knip --treat-config-hints-as-errors
```

### Preprocessing

Transform results before reporting.

```bash { .api }
# Apply preprocessors (can be repeated)
knip --preprocessor sort
knip --preprocessor filter --preprocessor sort

# Pass options to preprocessors (JSON format)
knip --preprocessor-options '{"filter":{"minSeverity":"error"}}'
```

### Tag Filtering

Filter exports based on JSDoc-style tags.

```bash { .api }
# Include or exclude tagged exports
knip --tags

# Legacy flag (deprecated, use --tags)
knip --experimental-tags
```

**Supported Tags:**

- `@public` - Mark as public API
- `@internal` - Mark as internal/private
- `@beta` - Mark as beta/experimental
- `@alias` - Mark as alias

### Exit Codes and Error Handling

Control CLI exit behavior.

```bash { .api }
# Always exit with code 0 (success)
knip --no-exit-code

# Set maximum issues before error exit (default: 0)
knip --max-issues 10
```

**Exit Codes:**

- `0` - Success (no issues or `--no-exit-code`)
- `1` - Issues found exceeding `--max-issues` threshold
- `2` - Runtime error or configuration problem

### Debug and Performance

Debugging and performance analysis options.

```bash { .api }
# Show debug output
knip --debug
knip -d

# Show trace output for analysis
knip --trace

# Trace specific exports
knip --trace-export MyFunction
knip --trace-export MyClass,MyInterface

# Trace exports in specific file
knip --trace-file src/api.ts

# Performance measurement
knip --performance

# Measure specific function performance
knip --performance-fn analyzeSourceFile

# Memory usage tracking
knip --memory

# Real-time memory usage logging
knip --memory-realtime
```

### Configuration Examples

Common CLI usage patterns.

```bash { .api }
# Development workflow
knip --watch --reporter compact

# CI/CD pipeline
knip --production --reporter json --no-progress --max-issues 0

# Pre-commit hook
knip --include exports,types --fix --format

# Code review
knip --reporter markdown > knip-report.md

# Dependency audit
knip --dependencies --reporter json

# Export cleanup
knip --exports --fix --no-exit-code

# Performance analysis
knip --performance --memory --debug

# Monorepo analysis
knip --workspace packages/frontend --production
knip --isolate-workspaces --reporter json
```

### Environment Variables

Environment variables that affect CLI behavior.

```bash { .api }
# Disable progress in CI environments (automatic)
CI=true knip

# Custom cache location
KNIP_CACHE_LOCATION=/tmp/knip-cache knip --cache

# Node environment affects plugin behavior
NODE_ENV=production knip
```

### Integration Examples

**Package.json Scripts:**

```json
{
  "scripts": {
    "knip": "knip",
    "knip:ci": "knip --reporter json --no-progress",
    "knip:fix": "knip --fix --format",
    "knip:prod": "knip --production --strict"
  }
}
```

**GitHub Actions:**

```yaml
- name: Run Knip
  run: |
    npm run knip:ci > knip-results.json
    if [ -s knip-results.json ]; then
      echo "Issues found:"
      cat knip-results.json
      exit 1
    fi
```

**Pre-commit Hook:**

```bash
#!/bin/sh
# .git/hooks/pre-commit
npx knip --include exports --fix --format --no-exit-code
git add -u
```

**Watch Script:**

```bash
#!/bin/bash
# watch-knip.sh
npx knip --watch --reporter compact --no-progress
```

### CLI Arguments Interface

TypeScript interface for CLI arguments (for tool integration).

```typescript { .api }
interface CLIArguments {
  /** Configuration file path */
  config?: string;
  /** TypeScript configuration path */
  tsConfig?: string;
  /** Production mode */
  production?: boolean;
  /** Strict mode */
  strict?: boolean;
  /** Single workspace analysis */
  workspace?: string;
  /** Working directory */
  directory?: string;
  /** Enable caching */
  cache?: boolean;
  /** Cache location */
  'cache-location'?: string;
  /** Watch mode */
  watch?: boolean;
  /** Don't use .gitignore */
  'no-gitignore'?: boolean;
  /** Issue types to include */
  include?: string | string[];
  /** Issue types to exclude */
  exclude?: string | string[];
  /** Dependency shortcut */
  dependencies?: boolean;
  /** Exports shortcut */
  exports?: boolean;
  /** Files shortcut */
  files?: boolean;
  /** Fix issues */
  fix?: boolean;
  /** Fix specific types */
  'fix-type'?: string | string[];
  /** Allow file removal */
  'allow-remove-files'?: boolean;
  /** Format after fixing */
  format?: boolean;
  /** Include external libs */
  'include-libs'?: boolean;
  /** Include entry exports */
  'include-entry-exports'?: boolean;
  /** Isolate workspaces */
  'isolate-workspaces'?: boolean;
  /** Don't show progress */
  'no-progress'?: boolean;
  /** Preprocessor */
  preprocessor?: string | string[];
  /** Preprocessor options */
  'preprocessor-options'?: string;
  /** Reporter */
  reporter?: string | string[];
  /** Reporter options */
  'reporter-options'?: string;
  /** Tag filtering */
  tags?: string | string[];
  /** Disable config hints */
  'no-config-hints'?: boolean;
  /** Config hints as errors */
  'treat-config-hints-as-errors'?: boolean;
  /** Always exit 0 */
  'no-exit-code'?: boolean;
  /** Maximum issues */
  'max-issues'?: number;
  /** Debug output */
  debug?: boolean;
  /** Trace output */
  trace?: boolean;
  /** Trace export */
  'trace-export'?: string | string[];
  /** Trace file */
  'trace-file'?: string | string[];
  /** Performance measurement */
  performance?: boolean;
  /** Performance function */
  'performance-fn'?: string | string[];
  /** Memory usage */
  memory?: boolean;
  /** Real-time memory */
  'memory-realtime'?: boolean;
  /** Show help */
  help?: boolean;
  /** Show version */
  version?: boolean;
}
```
