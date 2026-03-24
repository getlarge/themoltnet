# Plugin System

Extensive plugin architecture supporting 129+ tools and frameworks with automatic detection and configuration. Plugins extend Knip's analysis capabilities to understand project-specific patterns and configurations.

## Capabilities

### Plugin Interface

Core plugin interface for extending Knip functionality.

```typescript { .api }
/**
 * Plugin interface for extending Knip analysis
 */
interface Plugin {
  /** Display name for the plugin */
  title: string;
  /** CLI argument configuration */
  args?: Args;
  /** Path to package.json or function to check manifest */
  packageJsonPath?: string | ((manifest: PackageJson) => unknown);
  /** Dependencies/files that enable this plugin */
  enablers?: IgnorePatterns | string;
  /** Custom plugin enablement logic */
  isEnabled?: IsPluginEnabled;
  /** Only run in root workspace */
  isRootOnly?: boolean;
  /** Configuration file patterns */
  config?: string[];
  /** Entry file patterns */
  entry?: string[];
  /** Production-specific file patterns */
  production?: string[];
  /** Project file patterns */
  project?: string[];
  /** Plugin setup function */
  setup?: PluginSetup;
  /** Plugin teardown function */
  teardown?: PluginTeardown;
  /** Function to determine if config should be loaded */
  isLoadConfig?: IsLoadConfig;
  /** Function to resolve configuration files */
  resolveConfig?: ResolveConfig;
  /** Function to resolve additional inputs */
  resolve?: Resolve;
  /** Function to resolve inputs from AST */
  resolveFromAST?: ResolveFromAST;
}

type IsPluginEnabled = (
  options: IsPluginEnabledOptions,
) => boolean | Promise<boolean>;

interface IsPluginEnabledOptions {
  cwd: string;
  manifest: PackageJson;
  dependencies: Set<string>;
  config: WorkspaceConfiguration;
}

type PluginSetup = (options: PluginOptions) => Promise<void> | void;
type PluginTeardown = (options: PluginOptions) => Promise<void> | void;
type IsLoadConfig = (
  options: PluginOptions,
  dependencies: Set<string>,
) => boolean;
type ResolveConfig<T = any> = (
  config: T,
  options: PluginOptions,
) => Promise<Input[]> | Input[];
type Resolve = (options: PluginOptions) => Promise<Input[]> | Input[];
```

**Usage Examples:**

### Creating Custom Plugins

```typescript
import type { Plugin } from 'knip';

const myCustomPlugin: Plugin = {
  title: 'My Custom Tool',
  enablers: ['my-custom-tool'],
  config: ['my-tool.config.{js,json}'],
  entry: ['src/my-tool-entries/**/*.js'],
  resolve: async (options) => {
    // Custom logic to find additional entry points
    return [{ filePath: 'src/generated.js' }, { filePath: 'scripts/build.js' }];
  },
};
```

### Available Plugins

Knip includes 129+ built-in plugins for popular tools and frameworks.

```typescript { .api }
/** Map of all available plugins */
const plugins: Record<PluginName, Plugin>;

/** Union type of all plugin names */
type PluginName =
  | 'angular'
  | 'astro'
  | 'ava'
  | 'babel'
  | 'biome'
  | 'bun'
  | 'c8'
  | 'capacitor'
  | 'changelogen'
  | 'changesets'
  | 'commitizen'
  | 'commitlint'
  | 'convex'
  | 'create-typescript-app'
  | 'cspell'
  | 'cucumber'
  | 'cypress'
  | 'dependency-cruiser'
  | 'docusaurus'
  | 'drizzle'
  | 'eleventy'
  | 'eslint'
  | 'expo'
  | 'gatsby'
  | 'github-actions'
  | 'glob'
  | 'graphql-codegen'
  | 'husky'
  | 'jest'
  | 'knip'
  | 'lefthook'
  | 'lint-staged'
  | 'markdownlint'
  | 'mocha'
  | 'msw'
  | 'next'
  | 'node-test-runner'
  | 'nodemon'
  | 'npm-package-json-lint'
  | 'nuxt'
  | 'nx'
  | 'oclif'
  | 'playwright'
  | 'postcss'
  | 'prettier'
  | 'react'
  | 'release-it'
  | 'remix'
  | 'rollup'
  | 'rush'
  | 'semantic-release'
  | 'storybook'
  | 'tailwind'
  | 'tsup'
  | 'typescript'
  | 'unbuild'
  | 'vite'
  | 'vitest'
  | 'vue'
  | 'webpack'
  | 'wireit'
  | 'xo'
  | 'yarn';
// ... and 80+ more
```

**Popular Plugins:**

### Framework Plugins

```typescript
// Next.js plugin
const nextPlugin: Plugin = {
  title: 'Next.js',
  enablers: ['next'],
  config: ['next.config.{js,mjs,ts}'],
  entry: ['pages/**/*.{js,jsx,ts,tsx}', 'app/**/*.{js,jsx,ts,tsx}'],
};

// React plugin
const reactPlugin: Plugin = {
  title: 'React',
  enablers: ['react', 'react-dom'],
  entry: ['src/**/*.{jsx,tsx}'],
};

// Vue plugin
const vuePlugin: Plugin = {
  title: 'Vue',
  enablers: ['vue'],
  entry: ['src/**/*.vue'],
};
```

### Testing Framework Plugins

```typescript
// Jest plugin
const jestPlugin: Plugin = {
  title: 'Jest',
  enablers: ['jest'],
  config: ['jest.config.{js,ts,mjs,cjs,json}'],
  entry: ['**/*.{test,spec}.{js,ts,tsx,jsx}'],
};

// Cypress plugin
const cypressPlugin: Plugin = {
  title: 'Cypress',
  enablers: ['cypress'],
  config: ['cypress.config.{js,ts}'],
  entry: ['cypress/**/*.{js,ts}'],
};

// Playwright plugin
const playwrightPlugin: Plugin = {
  title: 'Playwright',
  enablers: ['@playwright/test', 'playwright'],
  config: ['playwright.config.{js,ts}'],
  entry: ['**/*.{test,spec}.{js,ts}'],
};
```

### Build Tool Plugins

```typescript
// Webpack plugin
const webpackPlugin: Plugin = {
  title: 'Webpack',
  enablers: ['webpack'],
  config: ['webpack.config.{js,ts}'],
  entry: ['webpack.config.{js,ts}'],
};

// Vite plugin
const vitePlugin: Plugin = {
  title: 'Vite',
  enablers: ['vite'],
  config: ['vite.config.{js,ts,mjs}'],
  entry: ['vite.config.{js,ts,mjs}'],
};

// Rollup plugin
const rollupPlugin: Plugin = {
  title: 'Rollup',
  enablers: ['rollup'],
  config: ['rollup.config.{js,ts,mjs}'],
  entry: ['rollup.config.{js,ts,mjs}'],
};
```

### Plugin Options

Configuration options passed to plugin functions.

```typescript { .api }
interface PluginOptions {
  /** Root working directory */
  rootCwd: string;
  /** Current working directory */
  cwd: string;
  /** Set of npm script names */
  manifestScriptNames: Set<string>;
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
  /** Function to get inputs from npm scripts */
  getInputsFromScripts: GetInputsFromScriptsPartial;
}

interface EnsuredPluginConfiguration {
  /** Configuration file patterns */
  config: string[] | null;
  /** Entry file patterns */
  entry: string[] | null;
  /** Project file patterns */
  project: string[] | null;
}

type GetInputsFromScriptsPartial = (
  npmScripts: string | string[] | Set<string>,
  options?: Partial<GetInputsFromScriptsOptions>,
) => Input[];
```

### Plugin Resolution

Functions for resolving plugin inputs and configurations.

```typescript { .api }
/**
 * Input representing a file or dependency
 */
interface Input {
  /** File path */
  filePath: string;
  /** Optional specifier for the input */
  specifier?: string;
}

/**
 * Resolve configuration function type
 */
type ResolveConfig<T = any> = (
  config: T,
  options: PluginOptions,
) => Promise<Input[]> | Input[];

/**
 * Resolve function type for finding additional inputs
 */
type Resolve = (options: PluginOptions) => Promise<Input[]> | Input[];

/**
 * Resolve from AST function type
 */
type ResolveFromAST = (
  sourceFile: ts.SourceFile,
  options: PluginOptions & {
    getSourceFile: GetSourceFile;
    getReferencedInternalFilePath: GetReferencedInternalFilePath;
  },
) => Input[];

type GetSourceFile = (filePath: string) => ts.SourceFile | undefined;
type GetReferencedInternalFilePath = (input: Input) => string | undefined;
```

**Plugin Resolution Examples:**

```typescript
// Example plugin with custom resolution
const examplePlugin: Plugin = {
  title: 'Example Plugin',
  enablers: ['example-tool'],

  resolve: async (options) => {
    // Find additional entry points from package.json scripts
    const inputs = options.getInputsFromScripts(
      options.manifest.scripts?.build || [],
      { containingFilePath: options.configFilePath },
    );

    return inputs;
  },

  resolveConfig: async (config, options) => {
    // Parse configuration file to find referenced files
    return (
      config.files?.map((file: string) => ({
        filePath: path.resolve(options.configFileDir, file),
      })) || []
    );
  },

  resolveFromAST: (sourceFile, options) => {
    // Analyze TypeScript AST to find dynamic imports
    const inputs: Input[] = [];

    // Custom AST traversal logic here
    // to find require() calls, dynamic imports, etc.

    return inputs;
  },
};
```

### Plugin Configuration

Plugins can be configured globally or per workspace.

```typescript { .api }
type PluginConfiguration = boolean | EnsuredPluginConfiguration;

type PluginsConfiguration = Record<PluginName, PluginConfiguration>;

interface WorkspaceConfiguration {
  /** Plugin configurations for this workspace */
  [pluginName: string]: PluginConfiguration | any;
}
```

**Configuration Examples:**

```json
{
  "eslint": {
    "config": ["eslint.config.js"],
    "entry": ["src/**/*.test.js"]
  },
  "jest": true,
  "webpack": false,
  "workspaces": {
    "frontend": {
      "jest": {
        "config": ["jest.config.frontend.js"]
      },
      "react": true
    }
  }
}
```
