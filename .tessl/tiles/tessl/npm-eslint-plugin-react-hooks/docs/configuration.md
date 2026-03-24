# Configuration Guide

This document covers all configuration options and presets available in eslint-plugin-react-hooks, including setup for different ESLint versions and custom rule configurations.

## Configuration Presets

The plugin provides four pre-configured setups for different ESLint versions and configuration formats.

```typescript { .api }
interface PluginConfigs {
  recommended: LegacyConfig; // Original legacy config
  'recommended-legacy': LegacyConfig; // Explicit legacy config
  'recommended-latest': FlatConfig[]; // Flat config for ESLint 5.2.0
  'flat/recommended': FlatConfig[]; // Flat config for ESLint 6.0.0+
}
```

### Legacy Configuration (.eslintrc)

For ESLint versions that use .eslintrc configuration files.

#### recommended (< 5.2.0)

Original configuration for older versions:

```javascript
{
  "extends": [
    "plugin:react-hooks/recommended"
  ]
}
```

#### recommended-legacy (>= 5.2.0)

Explicit legacy configuration for newer versions with legacy support:

```javascript { .api }
// Actual configuration from src/index.ts
const ruleConfigs = {
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'warn',
  // React Compiler rules (automatically mapped from recommendedRules with severity)
  'react-hooks/component-hook-factories': 'error',
  'react-hooks/config': 'error',
  'react-hooks/error-boundaries': 'error',
  'react-hooks/gating': 'error',
  'react-hooks/globals': 'error',
  'react-hooks/immutability': 'error',
  'react-hooks/incompatible-library': 'warn',
  'react-hooks/no-unused-directives': 'error',
  'react-hooks/preserve-manual-memoization': 'error',
  'react-hooks/purity': 'error',
  'react-hooks/refs': 'error',
  'react-hooks/set-state-in-effect': 'error',
  'react-hooks/static-components': 'error',
  'react-hooks/unsupported-syntax': 'warn',
  'react-hooks/use-memo': 'error',
};

const recommendedLegacyConfig = {
  plugins: ['react-hooks'],
  rules: ruleConfigs,
};
```

Usage:

```javascript
{
  "extends": [
    "plugin:react-hooks/recommended-legacy"
  ]
}
```

### Flat Configuration (eslint.config.js)

For ESLint's modern flat configuration format.

#### recommended-latest (5.2.0)

For the first version with flat config support:

```javascript { .api }
const recommendedLatestConfig = [
  {
    plugins: {
      'react-hooks': plugin,
    },
    rules: ruleConfigs, // Same rules as legacy config
  },
];
```

Usage:

```javascript
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    extends: ['react-hooks/recommended-latest'],
  },
];
```

#### flat/recommended (6.0.0+)

For ESLint 6.0.0 and later with full flat config support:

```javascript { .api }
const flatRecommendedConfig = [
  {
    plugins: {
      'react-hooks': plugin,
    },
    rules: ruleConfigs, // Same rules as legacy config
  },
];
```

Usage:

```javascript
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    extends: ['react-hooks/recommended'],
  },
];
```

## Custom Configuration

### Manual Rule Setup

Configure specific rules individually without using presets:

```javascript { .api }
// Legacy format
const customLegacyConfig = {
  plugins: ['react-hooks'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': [
      'warn',
      {
        additionalHooks: '(useMyCustomHook|useMyOtherCustomHook)',
      },
    ],
    'react-hooks/immutability': 'error',
    'react-hooks/purity': 'warn',
  },
};

// Flat format
const customFlatConfig = [
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': [
        'warn',
        {
          additionalHooks: '(useMyCustomHook|useMyOtherCustomHook)',
        },
      ],
      'react-hooks/immutability': 'error',
      'react-hooks/purity': 'warn',
    },
  },
];
```

### File-Specific Configuration

Apply different rules to different file patterns:

```javascript
// Flat config with file-specific rules
export default [
  {
    files: ['src/components/**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error', // Stricter for components
      'react-hooks/immutability': 'error',
    },
  },
  {
    files: ['src/hooks/**/*.{js,ts}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn', // More lenient for custom hooks
      'react-hooks/purity': 'error',
    },
  },
];
```

## Rule-Specific Configuration

### Exhaustive Dependencies Configuration

The exhaustive-deps rule accepts configuration for custom hooks:

```typescript { .api }
interface ExhaustiveDepsOptions {
  additionalHooks?: string; // RegExp pattern string
}
```

Examples:

```javascript
{
  "rules": {
    "react-hooks/exhaustive-deps": ["warn", {
      // Single custom hook
      "additionalHooks": "useMyCustomHook"
    }]
  }
}

{
  "rules": {
    "react-hooks/exhaustive-deps": ["warn", {
      // Multiple custom hooks
      "additionalHooks": "(useMyCustomHook|useMyOtherCustomHook|useThirdHook)"
    }]
  }
}

{
  "rules": {
    "react-hooks/exhaustive-deps": ["warn", {
      // Pattern matching for hook families
      "additionalHooks": "use[A-Z].*Effect"
    }]
  }
}
```

### React Compiler Rule Configuration

Most React Compiler rules don't accept additional configuration, but some do:

```javascript
{
  "rules": {
    // Example compiler rule configurations
    "react-hooks/config": "error",
    "react-hooks/gating": ["warn", { /* compiler-specific options */ }],
    "react-hooks/immutability": "error",
    "react-hooks/no-unused-directives": "warn"
  }
}
```

## Environment-Specific Configuration

### Node.js vs Browser

```javascript
export default [
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    extends: ['react-hooks/recommended'],
  },
  {
    files: ['scripts/**/*.js', '*.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Only basic rules for non-React files
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];
```

### TypeScript Integration

```javascript
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      '@typescript-eslint': tseslint,
    },
    extends: ['react-hooks/recommended', '@typescript-eslint/recommended'],
    rules: {
      // Enhanced rules for TypeScript
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/immutability': 'error',
    },
  },
];
```

## Migration Guide

### From Legacy to Flat Config

Migrating from .eslintrc to flat config:

```javascript
// Old .eslintrc.js
module.exports = {
  extends: ['plugin:react-hooks/recommended'],
  rules: {
    'react-hooks/exhaustive-deps': [
      'warn',
      {
        additionalHooks: 'useMyHook',
      },
    ],
  },
};

// New eslint.config.js
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    plugins: { 'react-hooks': reactHooks },
    extends: ['react-hooks/recommended'],
    rules: {
      'react-hooks/exhaustive-deps': [
        'warn',
        {
          additionalHooks: 'useMyHook',
        },
      ],
    },
  },
];
```

### Version-Specific Configurations

```javascript
// For ESLint < 9.0.0 (legacy support)
{
  "extends": ["plugin:react-hooks/recommended-legacy"]
}

// For ESLint 5.2.0 (first flat config support)
import reactHooks from 'eslint-plugin-react-hooks';
export default [...reactHooks.configs['recommended-latest']];

// For ESLint >= 6.0.0 (full flat config)
import reactHooks from 'eslint-plugin-react-hooks';
export default [...reactHooks.configs['flat/recommended']];
```

## Configuration Types

```typescript { .api }
// Configuration type definitions
interface LegacyConfig {
  plugins: string[];
  rules: Record<string, ESLintRuleSeverity>;
}

interface FlatConfig {
  files?: string[];
  plugins: Record<string, ESLintPlugin>;
  rules: Record<string, ESLintRuleSeverity>;
  languageOptions?: {
    globals?: Record<string, boolean>;
    parser?: any;
    parserOptions?: any;
  };
}

type ESLintRuleSeverity =
  | 'off'
  | 0
  | 'warn'
  | 1
  | 'error'
  | 2
  | [ESLintRuleSeverity, any]; // With options

// Plugin interface
interface ESLintPlugin {
  meta: {
    name: string;
    version?: string;
  };
  rules: Record<string, Rule.RuleModule>;
  configs?: Record<string, LegacyConfig | FlatConfig[]>;
}
```

## Troubleshooting

### Common Configuration Issues

1. **Plugin not found**: Ensure eslint-plugin-react-hooks is installed
2. **Rules not working**: Check that files match the configuration pattern
3. **Version compatibility**: Use appropriate config for your ESLint version
4. **Custom hooks not validated**: Verify additionalHooks regex pattern

### Debug Configuration

```javascript
// Enable debug logging for rule execution
export default [
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/exhaustive-deps': [
        'warn',
        {
          additionalHooks: 'useMyHook',
        },
      ],
    },
    settings: {
      'react-hooks': {
        debug: true,
      },
    },
  },
];
```
