# Core Analysis

Core programmatic interface for analyzing projects and detecting unused code, dependencies, and files. The analysis engine processes workspaces and builds dependency graphs to identify issues.

## Capabilities

### Main Analysis Function

The primary entry point for programmatic analysis of projects.

```typescript { .api }
/**
 * Main analysis function that processes workspace and returns issues
 * @param options - Configuration options for analysis
 * @returns Promise resolving to analysis results
 */
function main(options: MainOptions): Promise<MainResult>;

interface MainOptions {
  /** Current working directory for analysis */
  cwd: string;
  /** Cache location for analysis results */
  cacheLocation: string;
  /** Configuration CLI argument */
  config?: string;
  /** Configuration file path */
  configFilePath?: string;
  /** Dependencies flag from CLI */
  dependencies: boolean;
  /** Exports flag from CLI */
  exports: boolean;
  /** Files flag from CLI */
  files: boolean;
  /** Experimental tags for filtering analysis */
  experimentalTags: string[];
  /** Types to include in fixes */
  fixTypes: string[];
  /** Whether to respect .gitignore files */
  gitignore: boolean;
  /** Specific issue types to include in analysis */
  includedIssueTypes: Partial<Report>;
  /** Enable caching */
  isCache: boolean;
  /** Debug mode */
  isDebug: boolean;
  /** Disable configuration hints */
  isDisableConfigHints: boolean;
  /** Fix issues automatically */
  isFix: boolean;
  /** Fix dependencies */
  isFixDependencies: boolean;
  /** Fix unused files */
  isFixFiles: boolean;
  /** Fix unused exports */
  isFixUnusedExports: boolean;
  /** Fix unused types */
  isFixUnusedTypes: boolean;
  /** Format files after fixing */
  isFormat: boolean;
  /** Include entry exports in unused exports report */
  isIncludeEntryExports: boolean;
  /** Isolate workspaces into separate programs */
  isIsolateWorkspaces: boolean;
  /** Analyze only production source files (no test files, devDependencies) */
  isProduction: boolean;
  /** Report class members */
  isReportClassMembers: boolean;
  /** Report dependencies issues */
  isReportDependencies: boolean;
  /** Report type issues */
  isReportTypes: boolean;
  /** Report value issues */
  isReportValues: boolean;
  /** Show dynamic progress updates */
  isShowProgress: boolean;
  /** Skip library files */
  isSkipLibs: boolean;
  /** Consider only direct dependencies of workspace */
  isStrict: boolean;
  /** Trace mode for debugging */
  isTrace: boolean;
  /** Treat configuration hints as errors */
  isTreatConfigHintsAsErrors: boolean;
  /** Watch mode for continuous analysis */
  isWatch: boolean;
  /** Parsed configuration object */
  parsedConfig: KnipConfig;
  /** Issue severity rules */
  rules: Record<string, 'error' | 'warn' | 'off'>;
  /** Tags for filtering exports */
  tags: string[];
  /** Export to trace */
  traceExport?: string;
  /** File to trace */
  traceFile?: string;
  /** TypeScript configuration file path */
  tsConfigFile?: string;
  /** Single workspace to analyze */
  workspace?: string;
  /** Available workspaces */
  workspaces: string[];
}

interface MainResult {
  /** Collected issues organized by type */
  issues: Issues;
  /** Counters for each issue type */
  counters: Counters;
  /** Hints about tagged exports */
  tagHints: Set<TagHint>;
  /** Configuration improvement suggestions */
  configurationHints: Set<ConfigurationHint>;
  /** List of included workspace directories */
  includedWorkspaceDirs: string[];
}
```

**Usage Examples:**

```typescript
import { main } from 'knip';

// Basic project analysis
const results = await main({
  cwd: process.cwd(),
  isShowProgress: true,
});

// Production-only analysis
const prodResults = await main({
  cwd: process.cwd(),
  isProduction: true,
  isStrict: true,
});

// Custom configuration
const customResults = await main({
  cwd: '/path/to/project',
  configFilePath: './knip.config.js',
  includedIssueTypes: {
    dependencies: true,
    exports: true,
    files: false,
  },
});

// Process results
console.log(`Total issues: ${results.counters.total}`);
console.log(`Unused dependencies: ${results.counters.dependencies}`);
console.log(`Unused exports: ${results.counters.exports}`);

// Access specific issues
for (const [filePath, fileIssues] of Object.entries(results.issues.exports)) {
  for (const [symbol, issue] of Object.entries(fileIssues)) {
    console.log(`Unused export "${symbol}" in ${filePath}`);
  }
}
```

### Analysis Results

The analysis results provide comprehensive information about detected issues.

```typescript { .api }
interface Issues {
  /** Unused files */
  files: Set<string>;
  /** Internal representation of unused files */
  _files: Record<string, Record<string, Issue>>;
  /** Unused dependencies */
  dependencies: Record<string, Record<string, Issue>>;
  /** Unused devDependencies */
  devDependencies: Record<string, Record<string, Issue>>;
  /** Referenced optional peerDependencies */
  optionalPeerDependencies: Record<string, Record<string, Issue>>;
  /** Unlisted dependencies */
  unlisted: Record<string, Record<string, Issue>>;
  /** Unlisted binaries */
  binaries: Record<string, Record<string, Issue>>;
  /** Unresolved imports */
  unresolved: Record<string, Record<string, Issue>>;
  /** Unused exports */
  exports: Record<string, Record<string, Issue>>;
  /** Unused exported types */
  types: Record<string, Record<string, Issue>>;
  /** Exports in used namespace */
  nsExports: Record<string, Record<string, Issue>>;
  /** Exported types in used namespace */
  nsTypes: Record<string, Record<string, Issue>>;
  /** Duplicate exports */
  duplicates: Record<string, Record<string, Issue>>;
  /** Unused exported enum members */
  enumMembers: Record<string, Record<string, Issue>>;
  /** Unused exported class members */
  classMembers: Record<string, Record<string, Issue>>;
}

interface Issue {
  /** Type of issue */
  type: IssueType;
  /** File path where issue occurs */
  filePath: string;
  /** Workspace containing the issue */
  workspace: string;
  /** Symbol name with the issue */
  symbol: string;
  /** Additional symbols involved */
  symbols?: IssueSymbol[];
  /** Type of symbol (variable, function, class, etc.) */
  symbolType?: SymbolType;
  /** Parent symbol if applicable */
  parentSymbol?: string;
  /** Import specifier if applicable */
  specifier?: string;
  /** Issue severity level */
  severity?: IssueSeverity;
  /** Position in file */
  pos?: number;
  /** Line number */
  line?: number;
  /** Column number */
  col?: number;
  /** Whether issue was automatically fixed */
  isFixed?: boolean;
}

interface Counters {
  files: number;
  dependencies: number;
  devDependencies: number;
  optionalPeerDependencies: number;
  unlisted: number;
  binaries: number;
  unresolved: number;
  exports: number;
  types: number;
  nsExports: number;
  nsTypes: number;
  duplicates: number;
  enumMembers: number;
  classMembers: number;
  processed: number;
  total: number;
}

type IssueType =
  | 'files'
  | 'dependencies'
  | 'devDependencies'
  | 'optionalPeerDependencies'
  | 'unlisted'
  | 'binaries'
  | 'unresolved'
  | 'exports'
  | 'types'
  | 'nsExports'
  | 'nsTypes'
  | 'duplicates'
  | 'enumMembers'
  | 'classMembers';

type IssueSeverity = 'error' | 'warn' | 'off';
```

### Analysis Options

Configuration options for customizing the analysis behavior.

```typescript { .api }
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

interface TagHint {
  type: 'tag';
  filePath: string;
  identifier: string;
  tagName: string;
}

interface ConfigurationHint {
  type: ConfigurationHintType;
  identifier: string | RegExp;
  filePath?: string;
  workspaceName?: string;
  size?: number;
}

type ConfigurationHintType =
  | 'ignoreBinaries'
  | 'ignoreDependencies'
  | 'ignoreUnresolved'
  | 'ignoreWorkspaces'
  | 'entry-redundant'
  | 'project-redundant'
  | 'entry-top-level'
  | 'project-top-level'
  | 'entry-empty'
  | 'project-empty'
  | 'package-entry'
  | 'workspace-unconfigured';
```

### Error Handling

The main function handles various error conditions and provides detailed error information.

**Common Error Scenarios:**

- **Configuration Error**: Invalid or missing configuration files
- **File System Error**: Inaccessible files or directories
- **TypeScript Error**: Invalid TypeScript configuration
- **Plugin Error**: Plugin-specific configuration or execution errors

```typescript
try {
  const results = await main(options);
  // Process successful results
} catch (error) {
  if (error.code === 'CONFIGURATION_ERROR') {
    console.error('Configuration error:', error.message);
  } else if (error.code === 'FILE_SYSTEM_ERROR') {
    console.error('File system error:', error.message);
  } else {
    console.error('Analysis error:', error.message);
  }
}
```
