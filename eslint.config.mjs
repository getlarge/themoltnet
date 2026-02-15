import eslint from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores (replaces .eslintignore and ignorePatterns)
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'libs/api-client/src/generated/**',
      'infra/ory/permissions.ts',
    ],
  },

  // Base recommended rules
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Workspace boundary rules — enforce layered architecture
  //
  // Element types (source files):
  //   app  — apps/*/src/**
  //   lib  — libs/*/src/**
  //   tool — tools/*/src/**
  //
  // Rules:
  //   libs  → cannot import app packages (@moltnet/{landing,mcp-server,rest-api,server})
  //   apps  → cannot import app packages
  //   tools → cannot import app packages
  {
    files: [
      'apps/*/src/**/*.ts',
      'apps/*/src/**/*.tsx',
      'libs/*/src/**/*.ts',
      'tools/*/src/**/*.ts',
    ],
    plugins: {
      boundaries,
    },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'apps/*/src/**', mode: 'file' },
        { type: 'lib', pattern: 'libs/*/src/**', mode: 'file' },
        { type: 'tool', pattern: 'tools/*/src/**', mode: 'file' },
      ],
      'boundaries/include': [
        'apps/*/src/**',
        'libs/*/src/**',
        'tools/*/src/**',
      ],
    },
    rules: {
      'boundaries/external': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: 'lib',
              disallow: [
                '@moltnet/landing',
                '@moltnet/mcp-server',
                '@moltnet/rest-api',
              ],
              message:
                'Libs must not import from apps. Extract shared code into a lib.',
            },
            {
              from: 'tool',
              disallow: [
                '@moltnet/landing',
                '@moltnet/mcp-server',
                '@moltnet/rest-api',
              ],
              message:
                'Tools must not import from apps. Extract shared code into a lib.',
            },
            {
              from: 'app',
              disallow: [
                '@moltnet/landing',
                '@moltnet/mcp-server',
                '@moltnet/rest-api',
              ],
              message:
                'Apps must not import from other apps. Extract shared code into a lib.',
            },
          ],
        },
      ],
    },
  },

  // All TypeScript files — shared rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-console': 'warn',
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'error',
      'no-return-await': 'error',
    },
  },

  // Source files — type-checked rules (stricter)
  {
    files: [
      'libs/*/src/**/*.ts',
      'libs/*/src/**/*.tsx',
      'apps/*/src/**/*.ts',
      'apps/*/src/**/*.tsx',
    ],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'no-return-await': 'off',
    },
  },

  // Packages that need relaxed unsafe-* rules (auto-instrumentation, TypeBox, React)
  {
    files: [
      'libs/observability/src/**/*.ts',
      'libs/models/src/**/*.ts',
      'apps/landing/src/**/*.ts',
      'apps/landing/src/**/*.tsx',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
    },
  },

  // Forbid direct process.env access in source files — use config module instead
  {
    files: [
      'libs/*/src/**/*.ts',
      'libs/*/src/**/*.tsx',
      'apps/*/src/**/*.ts',
      'apps/*/src/**/*.tsx',
    ],
    ignores: ['**/config.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Use the config module instead of accessing process.env directly.',
        },
      ],
    },
  },

  // React hooks rules for TSX files
  {
    files: ['**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Test files — relaxed rules
  {
    files: [
      '**/__tests__/**/*.ts',
      '**/__tests__/**/*.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
