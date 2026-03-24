# Issue Detection & Management

Comprehensive issue detection system categorizing different types of unused code and dependency problems. Knip identifies 14 different issue types across files, dependencies, and code symbols.

## Capabilities

### Issue Types

Core issue detection categories that Knip analyzes.

```typescript { .api }
/** All available issue types */
type IssueType =
  | 'files' // Unused files
  | 'dependencies' // Unused dependencies
  | 'devDependencies' // Unused devDependencies
  | 'optionalPeerDependencies' // Referenced optional peerDependencies
  | 'unlisted' // Unlisted dependencies
  | 'binaries' // Unlisted binaries
  | 'unresolved' // Unresolved imports
  | 'exports' // Unused exports
  | 'nsExports' // Exports in used namespace
  | 'types' // Unused exported types
  | 'nsTypes' // Exported types in used namespace
  | 'enumMembers' // Unused exported enum members
  | 'classMembers' // Unused exported class members
  | 'duplicates'; // Duplicate exports

/** Issue type titles for display */
const ISSUE_TYPE_TITLE: Record<IssueType, string> = {
  files: 'Unused files',
  dependencies: 'Unused dependencies',
  devDependencies: 'Unused devDependencies',
  optionalPeerDependencies: 'Referenced optional peerDependencies',
  unlisted: 'Unlisted dependencies',
  binaries: 'Unlisted binaries',
  unresolved: 'Unresolved imports',
  exports: 'Unused exports',
  nsExports: 'Exports in used namespace',
  types: 'Unused exported types',
  nsTypes: 'Exported types in used namespace',
  enumMembers: 'Unused exported enum members',
  classMembers: 'Unused exported class members',
  duplicates: 'Duplicate exports',
};
```

**Usage Examples:**

```typescript
import { main } from 'knip';

const results = await main({ cwd: process.cwd() });

// Check specific issue types
console.log(`Unused files: ${results.counters.files}`);
console.log(`Unused dependencies: ${results.counters.dependencies}`);
console.log(`Unused exports: ${results.counters.exports}`);

// Process all issues
for (const issueType of Object.keys(results.issues) as IssueType[]) {
  const count = results.counters[issueType];
  if (count > 0) {
    console.log(`Found ${count} ${issueType} issues`);
  }
}
```

### Issue Structure

Detailed information about each detected issue.

```typescript { .api }
interface Issue {
  /** Type of issue detected */
  type: SymbolIssueType;
  /** File path where issue occurs */
  filePath: string;
  /** Workspace containing the issue */
  workspace: string;
  /** Symbol name with the issue */
  symbol: string;
  /** Additional symbols involved in the issue */
  symbols?: IssueSymbol[];
  /** Type of symbol (variable, function, class, etc.) */
  symbolType?: SymbolType;
  /** Parent symbol if applicable (e.g., class for method) */
  parentSymbol?: string;
  /** Import specifier if applicable */
  specifier?: string;
  /** Issue severity level */
  severity?: IssueSeverity;
  /** Position in file (character offset) */
  pos?: number;
  /** Line number in file */
  line?: number;
  /** Column number in file */
  col?: number;
  /** Whether issue was automatically fixed */
  isFixed?: boolean;
}

interface IssueSymbol {
  /** Symbol name */
  symbol: string;
  /** Position in file (character offset) */
  pos?: number;
  /** Line number */
  line?: number;
  /** Column number */
  col?: number;
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

type SymbolIssueType = Exclude<IssueType, 'files'>;
type IssueSeverity = 'error' | 'warn' | 'off';
```

**Issue Processing Examples:**

```typescript
// Process unused exports
for (const [filePath, fileIssues] of Object.entries(results.issues.exports)) {
  for (const [symbol, issue] of Object.entries(fileIssues)) {
    console.log(`Unused export "${symbol}" in ${filePath}:${issue.line}`);

    if (issue.symbolType === 'function') {
      console.log(`  - Unused function: ${symbol}`);
    } else if (issue.symbolType === 'class') {
      console.log(`  - Unused class: ${symbol}`);
    }
  }
}

// Process unresolved imports
for (const [filePath, fileIssues] of Object.entries(
  results.issues.unresolved,
)) {
  for (const [specifier, issue] of Object.entries(fileIssues)) {
    console.log(
      `Unresolved import "${specifier}" in ${filePath}:${issue.line}`,
    );
  }
}

// Process unused dependencies
for (const [workspace, deps] of Object.entries(results.issues.dependencies)) {
  for (const [depName, issue] of Object.entries(deps)) {
    console.log(`Unused dependency "${depName}" in workspace ${workspace}`);
  }
}
```

### Issue Collection

The IssueCollector class manages issue detection and categorization.

```typescript { .api }
/**
 * Issue collection and management
 */
class IssueCollector {
  constructor(options: MainOptions);

  /** Get all collected issues with counters and hints */
  getIssues(): {
    issues: Issues;
    counters: Counters;
    tagHints: Set<TagHint>;
    configurationHints: Set<ConfigurationHint>;
  };
}

interface Issues {
  /** Unused files */
  files: Set<string>;
  /** Internal representation of unused files */
  _files: Record<string, Record<string, Issue>>;
  /** Unused dependencies by workspace */
  dependencies: Record<string, Record<string, Issue>>;
  /** Unused devDependencies by workspace */
  devDependencies: Record<string, Record<string, Issue>>;
  /** Referenced optional peerDependencies */
  optionalPeerDependencies: Record<string, Record<string, Issue>>;
  /** Unlisted dependencies by workspace */
  unlisted: Record<string, Record<string, Issue>>;
  /** Unlisted binaries by workspace */
  binaries: Record<string, Record<string, Issue>>;
  /** Unresolved imports by file */
  unresolved: Record<string, Record<string, Issue>>;
  /** Unused exports by file */
  exports: Record<string, Record<string, Issue>>;
  /** Unused exported types by file */
  types: Record<string, Record<string, Issue>>;
  /** Exports in used namespace by file */
  nsExports: Record<string, Record<string, Issue>>;
  /** Exported types in used namespace by file */
  nsTypes: Record<string, Record<string, Issue>>;
  /** Duplicate exports by file */
  duplicates: Record<string, Record<string, Issue>>;
  /** Unused exported enum members by file */
  enumMembers: Record<string, Record<string, Issue>>;
  /** Unused exported class members by file */
  classMembers: Record<string, Record<string, Issue>>;
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
  /** Total processed files */
  processed: number;
  /** Total issues found */
  total: number;
}
```

### Issue Fixing

Automatic fixing capabilities for certain issue types.

```typescript { .api }
/**
 * Issue fixing functionality
 */
class IssueFixer {
  constructor(options: MainOptions);

  /**
   * Fix identified issues automatically
   * @param issues - Issues to fix
   * @returns Set of modified file paths
   */
  fixIssues(issues: Issues): Promise<Set<string>>;
}
```

**Fixable Issue Types:**

- **Unused imports**: Remove unused import statements
- **Unused exports**: Remove unused export declarations
- **Unused variables**: Remove unused variable declarations
- **Unused dependencies**: Update package.json to remove unused deps

**Usage Examples:**

```typescript
import { main } from 'knip';

// Analyze and fix issues
const results = await main({
  cwd: process.cwd(),
  isFix: true,
  isFormat: true, // Format files after fixing
});

// Check what was fixed
const fixedIssues = Object.values(results.issues)
  .flatMap((issueGroup) => Object.values(issueGroup).flatMap(Object.values))
  .filter((issue) => issue.isFixed);

console.log(`Fixed ${fixedIssues.length} issues`);
```

### Issue Filtering

Control which issues are reported using include/exclude patterns.

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

interface Rules {
  files: IssueSeverity;
  dependencies: IssueSeverity;
  devDependencies: IssueSeverity;
  exports: IssueSeverity;
  types: IssueSeverity;
  unresolved: IssueSeverity;
  // ... other rule types
}
```

**Filtering Examples:**

```typescript
// Include only specific issue types
const results = await main({
  cwd: process.cwd(),
  includedIssueTypes: {
    dependencies: true,
    exports: true,
    files: false, // Don't report unused files
    types: false, // Don't report unused types
  },
});

// Configure issue severity
const options = {
  rules: {
    dependencies: 'error', // Exit with error code
    exports: 'warn', // Show warning
    types: 'off', // Ignore completely
  },
};
```

### Issue Tags

Support for tagged exports to control issue reporting.

```typescript { .api }
interface TagHint {
  type: 'tag';
  filePath: string;
  identifier: string;
  tagName: string;
}

/** Supported tag types */
const PUBLIC_TAG = '@public';
const INTERNAL_TAG = '@internal';
const BETA_TAG = '@beta';
const ALIAS_TAG = '@alias';
```

**Tag Usage Examples:**

```typescript
// Mark exports with tags to control reporting
export const internalUtil = () => {}; // @internal

/**
 * Public API function
 * @public
 */
export const publicFunction = () => {};

/**
 * Beta feature - may be removed
 * @beta
 */
export const betaFeature = () => {};
```
