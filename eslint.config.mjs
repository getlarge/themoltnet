import eslint from '@eslint/js';
import nxPlugin from '@nx/eslint-plugin';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores (replaces .eslintignore and ignorePatterns)
  {
    ignores: [
      '**/dist/**',
      '**/out-tsc/**',
      '**/node_modules/**',
      // Local Node-RED dev userDir created by the dev runner (runtime artifact).
      '**/.node-red-dev/**',
      'libs/api-client/src/generated/**',
      'infra/ory/permissions.ts',
      // Standalone node script invoked from a Dockerfile; not part of the
      // typed source graph and lacks the Node globals declared for src/.
      'tools/download-embedding-model.mjs',
      // Standalone node dev script (spins up a local Node-RED for the
      // node-red-contrib-core nodes); same rationale as above.
      'libs/node-red-contrib-core/scripts/dev.mjs',
    ],
  },

  // Base recommended rules
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Workspace boundary rules — driven by Nx project tags declared in each
  // package.json `nx.tags` block. Tag dimensions:
  //   type:     app | feature | runtime | data-access | client | ui | util | tool
  //   scope:    identity | diary | crypto | agent | task | platform | public | tooling | shared
  //   platform: server | browser | cli | extension | isomorphic
  //
  // Rules below encode the layered architecture. The lang:go tag exists for Go
  // projects (handled by golangci-lint depguard, not this rule).
  {
    files: [
      'apps/*/src/**/*.ts',
      'apps/*/src/**/*.tsx',
      'libs/*/src/**/*.ts',
      'libs/*/src/**/*.tsx',
      'tools/src/**/*.ts',
      'packages/*/src/**/*.ts',
      'packages/*/src/**/*.tsx',
    ],
    plugins: {
      '@nx': nxPlugin,
    },
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: [],
          depConstraints: [
            // Apps may depend on anything except other apps and tools.
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:runtime',
                'type:data-access',
                'type:client',
                'type:ui',
                'type:util',
              ],
            },
            // Features (domain services) may depend on lower layers only.
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:client',
                'type:util',
              ],
            },
            // Runtime libs (agent runtime, bootstrap, pi-extension) may use
            // features and lower; bootstrap legitimately needs data-access.
            {
              sourceTag: 'type:runtime',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:runtime',
                'type:data-access',
                'type:client',
                'type:util',
              ],
            },
            // Data-access is leaf-ish: only utils.
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            // UI libs may depend on UI, clients, and utils.
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:client', 'type:util'],
            },
            // Public API clients (sdk, api-client, cli, legreffier) may depend
            // on utils, other clients, and ui (the design-system has CLI/React
            // surfaces consumed by interactive CLIs).
            {
              sourceTag: 'type:client',
              onlyDependOnLibsWithTags: ['type:client', 'type:ui', 'type:util'],
            },
            // Utils are leaves — they depend only on other utils.
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            // Tools is a leaf — internal CLIs may consume anything but
            // nothing depends on them (enforced by tools NOT being in any
            // other rule's onlyDependOnLibsWithTags list).
            {
              sourceTag: 'type:tool',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:runtime',
                'type:data-access',
                'type:client',
                'type:util',
              ],
            },
            // Browser code cannot pull in server-only libs, nor server-only
            // npm packages. Banned externals are picked to surface the most
            // common foot-guns (Node servers, DB drivers, server frameworks,
            // workflow engines). Add to the list as new server deps appear.
            {
              sourceTag: 'platform:browser',
              onlyDependOnLibsWithTags: [
                'platform:browser',
                'platform:isomorphic',
              ],
              bannedExternalImports: [
                'fastify',
                '@fastify/*',
                'pg',
                'pg-pool',
                'drizzle-orm',
                'drizzle-orm/*',
                '@dbos-inc/*',
                '@ory/client',
              ],
            },
            // Server code cannot pull in browser-only libs nor browser-only
            // npm packages. `react` is intentionally NOT banned — Ink-based
            // CLIs render React in a terminal. `react-dom` is the real
            // browser marker.
            {
              sourceTag: 'platform:server',
              onlyDependOnLibsWithTags: [
                'platform:server',
                'platform:isomorphic',
              ],
              bannedExternalImports: ['react-dom', 'react-dom/*'],
            },
            // CLI binaries can use server, cli, extension, and isomorphic libs.
            // (agent-daemon is a CLI app that drives the pi-extension runtime.)
            {
              sourceTag: 'platform:cli',
              onlyDependOnLibsWithTags: [
                'platform:cli',
                'platform:server',
                'platform:extension',
                'platform:isomorphic',
              ],
            },
            // Pi-extension runs in Gondolin VM, may reach for cli/server libs.
            {
              sourceTag: 'platform:extension',
              onlyDependOnLibsWithTags: [
                'platform:extension',
                'platform:cli',
                'platform:server',
                'platform:isomorphic',
              ],
            },
            // Isomorphic libs may only depend on other isomorphic libs and
            // must not pull in platform-specific npm packages (server
            // frameworks, DB drivers, browser renderers, etc).
            {
              sourceTag: 'platform:isomorphic',
              onlyDependOnLibsWithTags: ['platform:isomorphic'],
              bannedExternalImports: [
                'fastify',
                '@fastify/*',
                'pg',
                'pg-pool',
                'drizzle-orm',
                'drizzle-orm/*',
                '@dbos-inc/*',
                '@ory/client',
                'react-dom',
                'react-dom/*',
              ],
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
      'libs/pi-extension/src/**/*.ts',
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
    ignores: ['**/config.ts', 'libs/pi-extension/**'],
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
