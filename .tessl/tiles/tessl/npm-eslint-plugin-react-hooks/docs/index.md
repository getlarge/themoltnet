# ESLint Plugin React Hooks

ESLint Plugin React Hooks enforces the Rules of Hooks for React applications, providing essential linting rules to ensure proper usage of React Hooks. The plugin includes core React Hooks validation rules and advanced React Compiler rules for enhanced static analysis and performance optimization.

## Package Information

- **Package Name**: eslint-plugin-react-hooks
- **Package Type**: npm
- **Language**: TypeScript
- **Installation**: `npm install eslint-plugin-react-hooks --save-dev`
- **Node Requirements**: Node.js 18+
- **ESLint Support**: ESLint 3.0.0 - 9.0.0

## Core Imports

ESM (Flat Config):

```javascript
import reactHooks from 'eslint-plugin-react-hooks';
```

CommonJS (Legacy Config):

```javascript
const reactHooks = require('eslint-plugin-react-hooks');
```

## Basic Usage

### Flat Config (ESLint 6.0.0+)

```javascript
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: reactHooks.configs['flat/recommended'][0].rules,
  },
];
```

### Legacy Config (.eslintrc)

```javascript
{
  "extends": [
    "plugin:react-hooks/recommended-legacy"
  ]
}
```

### Custom Rule Configuration

```javascript
{
  plugins: ['react-hooks'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn'
  }
}
```

## Architecture

ESLint Plugin React Hooks is built around several key components:

- **Core Rules**: Essential React Hooks validation (`rules-of-hooks`, `exhaustive-deps`)
- **React Compiler Integration**: 27 additional rules from babel-plugin-react-compiler for advanced analysis
- **Multiple Config Formats**: Support for both legacy (.eslintrc) and modern flat configurations
- **Extensible Rule System**: Configurable rule severity and custom hook validation
- **Code Path Analysis**: Internal AST analysis utilities for complex hook usage patterns

## Capabilities

### Core React Hooks Rules

Essential rules for enforcing React Hooks patterns and preventing common mistakes in React applications.

```typescript { .api }
// Core rules included in the plugin
const coreRules = {
  'rules-of-hooks': RulesOfHooksRule,
  'exhaustive-deps': ExhaustiveDepsRule,
};
```

[Core Rules](./core-rules.md)

### React Compiler Rules

Advanced static analysis rules from React Compiler for performance optimization and enhanced code quality validation.

```typescript { .api }
// React Compiler rules (27 total: 26 from ErrorCategory + 1 additional)
const compilerRules = {
  config: CompilerConfigRule,
  'set-state-in-effect': SetStateInEffectRule,
  immutability: ImmutabilityRule,
  'no-unused-directives': NoUnusedDirectivesRule,
  // ... 23 additional rules from ErrorCategory
};
```

[React Compiler Rules](./compiler-rules.md)

### Configuration Presets

Pre-configured ESLint configurations for different ESLint versions and setups.

```typescript { .api }
const configs = {
  recommended: LegacyConfig,
  'recommended-legacy': LegacyConfig,
  'recommended-latest': FlatConfig,
  'flat/recommended': FlatConfig,
};
```

[Configuration Guide](./configuration.md)

## Main Plugin API

```typescript { .api }
// Main plugin export (default export from src/index.ts)
interface ESLintPlugin {
  meta: {
    name: string;
  };
  rules: Record<string, ESLint.Rule.RuleModule>;
  configs: Record<string, ESLint.Linter.Config | ESLint.Linter.FlatConfig[]>;
}

// The actual plugin export structure
const plugin: ESLintPlugin = {
  meta: {
    name: 'eslint-plugin-react-hooks'
  },
  rules: {
    'rules-of-hooks': RulesOfHooksRule,
    'exhaustive-deps': ExhaustiveDepsRule,
    // 27 React Compiler rules from babel-plugin-react-compiler
    'config': CompilerConfigRule,
    'set-state-in-effect': SetStateInEffectRule,
    'no-unused-directives': NoUnusedDirectivesRule,
    // ... (24 additional compiler rules)
  },
  configs: {
    'recommended': LegacyConfig,
    'recommended-legacy': LegacyConfig,
    'recommended-latest': FlatConfig[],
    'flat/recommended': FlatConfig[]
  }
};

// Export as default
export default plugin;

// Rule severity mapping
type ESLintSeverity = 'error' | 'warn' | 'off';

// Configuration types
interface LegacyConfig {
  plugins: string[];
  rules: Record<string, ESLintSeverity>;
}

interface FlatConfig {
  plugins: Record<string, ESLintPlugin>;
  rules: Record<string, ESLintSeverity>;
}
```

## Type Definitions

```typescript { .api }
// ESLint Rule Module interface (from @types/eslint)
interface RuleModule {
  meta: {
    type: 'problem' | 'suggestion' | 'layout';
    docs: {
      description: string;
      recommended: boolean;
      url?: string;
    };
    fixable?: 'code' | 'whitespace';
    hasSuggestions?: boolean;
    schema: JSONSchema[];
  };
  create(context: RuleContext): RuleListener;
}

// Rule context interface
interface RuleContext {
  sourceCode?: SourceCode; // ESLint 9.0+
  getSourceCode?(): SourceCode; // Legacy
  filename?: string; // ESLint 9.0+
  getFilename?(): string; // Legacy
  report(descriptor: ReportDescriptor): void;
  options: any[];
}

// Rule listener interface
interface RuleListener {
  [key: string]: (node: ESTree.Node) => void;
}

// Report descriptor for rule violations
interface ReportDescriptor {
  message: string;
  loc?: SourceLocation;
  node?: ESTree.Node;
  suggest?: SuggestionReportDescriptor[];
}

interface SuggestionReportDescriptor {
  desc: string;
  fix(fixer: RuleFixer): Fix | Fix[] | null;
}
```
