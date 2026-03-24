# Configuration

Flexible configuration system supporting project-level and workspace-level settings with extensive customization options. Knip supports multiple configuration file formats and locations.

## Capabilities

### Configuration Types

Core configuration interface for customizing Knip behavior.

```typescript { .api }
/**
 * Main configuration type for Knip
 */
type KnipConfig = {
  /** Entry files patterns */
  entry?: string | string[];
  /** Project files patterns */
  project?: string | string[];
  /** Files to ignore during analysis */
  ignore?: string | string[];
  /** Binary executables to ignore */
  ignoreBinaries?: (string | RegExp)[];
  /** Dependencies to ignore */
  ignoreDependencies?: (string | RegExp)[];
  /** Unresolved imports to ignore */
  ignoreUnresolved?: (string | RegExp)[];
  /** Class/interface members to ignore */
  ignoreMembers?: (string | RegExp)[];
  /** Workspaces to ignore */
  ignoreWorkspaces?: string[];
  /** Export usage rules per file */
  ignoreExportsUsedInFile?: boolean | Partial<Record<SymbolType, boolean>>;
  /** Include entry exports in unused exports report */
  isIncludeEntryExports?: boolean;
  /** Workspace-specific configurations */
  workspaces?: Record<string, WorkspaceConfiguration>;
  /** Plugin configurations */
  [pluginName: string]: PluginConfiguration | any;
};

interface WorkspaceConfiguration {
  /** Entry files for this workspace */
  entry?: string | string[];
  /** Project files for this workspace */
  project?: string | string[];
  /** Files to ignore in this workspace */
  ignore?: string | string[];
  /** TypeScript path mappings */
  paths?: Record<string, string[]>;
  /** Include entry exports for this workspace */
  isIncludeEntryExports?: boolean;
  /** Plugin configurations for this workspace */
  [pluginName: string]: PluginConfiguration | any;
}

type PluginConfiguration =
  | boolean
  | {
      /** Configuration files for the plugin */
      config?: string | string[];
      /** Entry files for the plugin */
      entry?: string | string[];
      /** Project files for the plugin */
      project?: string | string[];
    };
```

**Usage Examples:**

### Basic Configuration

```json
{
  "entry": ["src/index.ts", "src/cli.ts"],
  "ignore": ["src/**/*.test.ts", "src/**/*.spec.ts"],
  "ignoreBinaries": ["git", "npm"],
  "ignoreDependencies": ["@types/*"],
  "project": ["src/**/*.ts", "scripts/**/*.js"]
}
```

### Workspace Configuration

```json
{
  "workspaces": {
    "packages/backend": {
      "entry": ["src/server.ts"],
      "ignore": ["src/**/*.test.ts"],
      "project": ["src/**/*.ts"]
    },
    "packages/frontend": {
      "entry": ["src/main.tsx"],
      "ignore": ["src/**/*.test.{ts,tsx}"],
      "project": ["src/**/*.{ts,tsx}"]
    }
  }
}
```

### Plugin-Specific Configuration

```json
{
  "eslint": true,
  "jest": {
    "config": ["jest.config.js"],
    "entry": ["src/**/*.test.ts", "src/**/*.spec.ts"]
  },
  "prettier": false,
  "webpack": {
    "config": ["webpack.config.js", "webpack.*.js"],
    "entry": ["src/webpack.config.js"]
  }
}
```

### Configuration File Locations

Knip searches for configuration in multiple locations and formats.

```typescript { .api }
/** Supported configuration file locations */
const KNIP_CONFIG_LOCATIONS = [
  'knip.json',
  'knip.jsonc',
  '.knip.json',
  '.knip.jsonc',
  'knip.ts',
  'knip.js',
  'knip.config.ts',
  'knip.config.js',
];
```

**Configuration Priority:**

1. CLI `--config` option
2. Configuration files in order listed above
3. `package.json` `knip` field
4. Default configuration

### Configuration Loading

Functions for loading and validating configuration files.

```typescript { .api }
/**
 * Create analysis options from CLI arguments and configuration
 * @param options - Partial options including parsed CLI args
 * @returns Complete options for analysis
 */
function createOptions(options: CreateOptions): Promise<MainOptions>;

interface CreateOptions {
  /** Parsed CLI arguments */
  parsedCLIArgs?: ParsedArgs;
  /** Working directory */
  cwd?: string;
  /** Additional option overrides */
  [key: string]: any;
}

/**
 * Load configuration file from specified path
 * @param configPath - Path to configuration file
 * @returns Parsed configuration object
 */
function loadConfig(configPath: string): Promise<KnipConfig>;
```

**Usage Examples:**

```typescript
import { createOptions, loadConfig } from 'knip';

// Load configuration manually
const config = await loadConfig('./knip.config.js');

// Create complete options from CLI args
const options = await createOptions({
  parsedCLIArgs: { production: true, config: './knip.json' },
  cwd: process.cwd(),
});
```

### Ignore Patterns

Various ignore pattern configurations for fine-tuning analysis.

```typescript { .api }
/** Pattern types for ignoring items */
type IgnorePatterns = (string | RegExp)[];

/** Export ignore configuration per symbol type */
type IgnoreExportsUsedInFile = boolean | Partial<Record<SymbolType, boolean>>;

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

**Advanced Ignore Examples:**

```json
{
  "ignoreDependencies": [
    "@types/*",
    /^@babel\/.*/,
    "webpack"
  ],
  "ignoreBinaries": [
    "git",
    "docker",
    /^npm.*/
  ],
  "ignoreUnresolved": [
    "virtual:*",
    "*.css",
    "*.png"
  ],
  "ignoreExportsUsedInFile": {
    "interface": true,
    "type": true,
    "enum": false
  }
}
```

### Plugin Configuration

Configuration system for enabling and configuring plugins.

```typescript { .api }
interface Plugin {
  /** Plugin display name */
  title: string;
  /** Files/packages that enable this plugin */
  enablers?: IgnorePatterns | string;
  /** Custom enablement logic */
  isEnabled?: IsPluginEnabled;
  /** Only run in root workspace */
  isRootOnly?: boolean;
  /** Configuration file patterns */
  config?: string[];
  /** Entry file patterns */
  entry?: string[];
  /** Production file patterns */
  production?: string[];
  /** Project file patterns */
  project?: string[];
}

type IsPluginEnabled = (options: PluginOptions) => boolean | Promise<boolean>;

interface PluginOptions {
  /** Root working directory */
  rootCwd: string;
  /** Current working directory */
  cwd: string;
  /** Package.json manifest */
  manifest: PackageJson;
  /** Plugin configuration */
  config: EnsuredPluginConfiguration;
  /** Configuration file directory */
  configFileDir: string;
  /** Configuration file name */
  configFileName: string;
  /** Configuration file path */
  configFilePath: string;
  /** Production mode flag */
  isProduction: boolean;
  /** List of enabled plugins */
  enabledPlugins: string[];
}
```

**Plugin Configuration Examples:**

```json
{
  "jest": {
    "config": ["jest.config.{js,ts,json}"],
    "entry": ["**/*.{test,spec}.{js,ts,tsx}"]
  },
  "typescript": {
    "config": ["tsconfig.json", "tsconfig.*.json"],
    "project": ["**/*.ts", "**/*.tsx"]
  },
  "webpack": {
    "config": ["webpack.config.js"],
    "entry": ["webpack.config.js"]
  }
}
```

### Configuration Validation

Knip validates configuration and provides helpful hints.

```typescript { .api }
interface ConfigurationHint {
  /** Type of configuration hint */
  type: ConfigurationHintType;
  /** Pattern or identifier causing the hint */
  identifier: string | RegExp;
  /** Associated file path */
  filePath?: string;
  /** Workspace name */
  workspaceName?: string;
  /** Size metric for the hint */
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

**Common Configuration Hints:**

- `entry-redundant`: Entry patterns that don't match any files
- `project-redundant`: Project patterns that don't match any files
- `workspace-unconfigured`: Workspaces without specific configuration
- `ignoreDependencies`: Suggest adding frequently unused dependencies to ignore list
