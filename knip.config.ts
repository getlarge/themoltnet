import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: ['dist/**', '**/dist/**'],
  // Infrastructure files are not imported but are used externally
  ignoreFiles: ['infra/**'],

  workspaces: {
    // ── Apps ──
    'apps/mcp-server': {
      entry: ['src/index.ts', '__tests__/**/*.test.ts'],
    },
    'apps/rest-api': {
      entry: ['src/index.ts', '__tests__/**/*.test.ts', 'scripts/*.ts'],
    },

    // ── Libs ──
    'libs/api-client': {
      entry: ['src/index.ts', 'openapi-ts.config.ts'],
      // Generated code — exports are intentionally broad (full API surface)
      ignore: ['src/generated/**'],
      ignoreDependencies: [
        // Used as an openapi-ts plugin (string reference, not an import)
        '@hey-api/client-fetch',
      ],
    },
    'libs/auth': {
      entry: ['src/index.ts', '__tests__/**/*.test.ts'],
    },
    'libs/crypto-service': {
      entry: ['src/index.ts', '__tests__/**/*.test.ts'],
    },
    'libs/database': {
      entry: ['{src/index,drizzle.config}.ts', '__tests__/**/*.test.ts'],
    },
    'libs/design-system': {
      entry: ['src/index.ts', 'demo/{main.tsx,vite.config.ts}'],
      project: ['src/**/*.{ts,tsx}', 'demo/**/*.{ts,tsx}'],
    },
    'libs/diary-service': {
      entry: ['src/index.ts', '__tests__/**/*.test.ts'],
    },
    'libs/models': {
      entry: ['src/index.ts', '__tests__/**/*.test.ts'],
    },
    'libs/observability': {
      entry: ['src/index.ts', '__tests__/**/*.test.ts'],
    },
  },
};

export default config;
