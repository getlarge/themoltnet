import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: ['dist/**', '**/dist/**'],
  // Infrastructure files are not imported but are used externally
  ignoreFiles: ['infra/**'],

  workspaces: {
    // ── Apps ──
    'apps/mcp-server': {
      entry: ['__tests__/**/*.test.ts'],
    },
    'apps/rest-api': {
      entry: ['__tests__/**/*.test.ts', 'scripts/*.ts'],
    },

    // ── Libs ──
    'libs/api-client': {
      entry: ['openapi-ts.config.ts'],
      // Generated code — exports are intentionally broad (full API surface)
      ignore: ['src/generated/**'],
      ignoreDependencies: [
        // Used as an openapi-ts plugin (string reference, not an import)
        '@hey-api/client-fetch',
      ],
    },
    'libs/auth': {
      entry: ['__tests__/**/*.test.ts'],
    },
    'libs/crypto-service': {
      entry: ['__tests__/**/*.test.ts'],
    },
    'libs/database': {
      entry: ['__tests__/**/*.test.ts'],
    },
    'libs/design-system': {
      entry: ['demo/{main.tsx,vite.config.ts}'],
      project: ['src/**/*.{ts,tsx}', 'demo/**/*.{ts,tsx}'],
    },
    'libs/diary-service': {
      entry: ['__tests__/**/*.test.ts'],
    },
    'libs/models': {
      entry: ['__tests__/**/*.test.ts'],
    },
    'libs/observability': {
      entry: ['__tests__/**/*.test.ts'],
      ignoreDependencies: [
        // Used as pino transport targets (string references, not imports)
        'pino-opentelemetry-transport',
        'pino-pretty',
      ],
    },
  },
};

export default config;
