# Knip

Knip is a comprehensive TypeScript and JavaScript analysis tool that automatically detects and helps fix unused dependencies, exports, and files in software projects. It provides both a command-line interface and programmatic API for analyzing codebases to identify dead code, unused dependencies, unreferenced exports, and unnecessary files.

## Package Information

- **Package Name**: knip
- **Package Type**: npm
- **Language**: TypeScript
- **Installation**: `npm install knip`

## Core Imports

```typescript
import { main, type KnipConfig } from 'knip';
```

For CommonJS:

```javascript
const { main } = require('knip');
```

## Basic Usage

### CLI Usage

```bash
# Analyze current project
npx knip

# Analyze with configuration file
npx knip --config knip.json

# Fix issues automatically
npx knip --fix

# Production analysis only
npx knip --production

# Watch mode for continuous analysis
npx knip --watch
```

### Programmatic Usage

```typescript
import { main } from 'knip';

// Basic analysis
const results = await main({
  cwd: process.cwd(),
  gitignore: true,
  isProduction: false,
  isShowProgress: true,
});

console.log(`Found ${results.counters.total} issues`);
console.log(`Unused files: ${results.counters.files}`);
console.log(`Unused dependencies: ${results.counters.dependencies}`);
```

## Architecture

Knip is built around several key components:

- **Analysis Engine**: Core functionality for scanning projects and building dependency graphs
- **Plugin System**: 129+ plugins for framework and tool-specific analysis
- **Configuration System**: Flexible workspace and project configuration
- **Issue Management**: Collection, categorization, and fixing of identified issues
- **Reporting System**: Multiple output formats for different workflows
- **CLI Interface**: Comprehensive command-line tool with extensive options

## Capabilities

### Core Analysis API

Main programmatic interface for analyzing projects and detecting unused code, dependencies, and files.

```typescript { .api }
function main(options: MainOptions): Promise<MainResult>;

interface MainOptions {
  cwd: string;
  gitignore?: boolean;
  isProduction?: boolean;
  isShowProgress?: boolean;
  includedIssueTypes?: Partial<Report>;
  // ... additional options
}

interface MainResult {
  issues: Issues;
  counters: Counters;
  tagHints: Set<TagHint>;
  configurationHints: Set<ConfigurationHint>;
  includedWorkspaceDirs: string[];
}
```

[Core Analysis](./analysis.md)

### Configuration Management

Flexible configuration system supporting project-level and workspace-level settings with extensive customization options.

```typescript { .api }
type KnipConfig = {
  entry?: string | string[];
  project?: string | string[];
  ignore?: string | string[];
  ignoreBinaries?: (string | RegExp)[];
  ignoreDependencies?: (string | RegExp)[];
  workspaces?: Record<string, WorkspaceConfiguration>;
  // ... additional configuration options
};
```

[Configuration](./configuration.md)

### Plugin System

Extensive plugin architecture supporting 129+ tools and frameworks with automatic detection and configuration.

```typescript { .api }
interface Plugin {
  title: string;
  enablers?: string | (string | RegExp)[];
  isEnabled?: (options: PluginOptions) => boolean | Promise<boolean>;
  config?: string[];
  entry?: string[];
  project?: string[];
  // ... additional plugin properties
}
```

[Plugins](./plugins.md)

### Issue Detection & Management

Comprehensive issue detection system categorizing different types of unused code and dependency problems.

```typescript { .api }
interface Issues {
  files: Set<string>;
  dependencies: Record<string, Record<string, Issue>>;
  devDependencies: Record<string, Record<string, Issue>>;
  exports: Record<string, Record<string, Issue>>;
  types: Record<string, Record<string, Issue>>;
  unresolved: Record<string, Record<string, Issue>>;
  // ... additional issue categories
}

enum SymbolType {
  VARIABLE = 'variable',
  TYPE = 'type',
  INTERFACE = 'interface',
  ENUM = 'enum',
  FUNCTION = 'function',
  CLASS = 'class',
  MEMBER = 'member',
  UNKNOWN = 'unknown',
}
```

[Issue Management](./issues.md)

### Reporting & Output

Multiple reporting formats and customizable output options for different workflows and CI/CD integration.

```typescript { .api }
interface ReporterOptions {
  report: Report;
  issues: Issues;
  counters: Counters;
  cwd: string;
  isProduction: boolean;
  options: string;
}

type Reporter = (options: ReporterOptions) => void;
```

[Reporting](./reporting.md)

### CLI Interface

Comprehensive command-line interface with extensive options for analysis, fixing, and workflow integration.

```typescript { .api }
interface CLIOptions {
  config?: string;
  tsConfig?: string;
  production?: boolean;
  strict?: boolean;
  workspace?: string;
  directory?: string;
  cache?: boolean;
  watch?: boolean;
  fix?: boolean;
  // ... additional CLI options
}
```

[CLI Usage](./cli.md)

## Types

```typescript { .api }
interface Issue {
  type: SymbolIssueType;
  filePath: string;
  workspace: string;
  symbol: string;
  symbolType?: SymbolType;
  pos?: number;
  line?: number;
  col?: number;
}

interface Counters {
  files: number;
  dependencies: number;
  devDependencies: number;
  exports: number;
  types: number;
  unresolved: number;
  processed: number;
  total: number;
}

interface Report {
  files: boolean;
  dependencies: boolean;
  devDependencies: boolean;
  exports: boolean;
  types: boolean;
  unresolved: boolean;
  // ... additional report flags
}

interface ConfigurationHint {
  type: ConfigurationHintType;
  identifier: string | RegExp;
  filePath?: string;
  workspaceName?: string;
}

interface TagHint {
  type: 'tag';
  filePath: string;
  identifier: string;
  tagName: string;
}
```
