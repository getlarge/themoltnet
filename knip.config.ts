import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: ['dist/**', '**/dist/**'],
  // Infrastructure files are not imported but are used externally
  ignoreFiles: ['infra/**'],

  workspaces: {
    // ── Apps ──
    'apps/mcp-server': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'apps/rest-api': {
      entry: ['__tests__/**/*.spec.ts', 'e2e/**/*.ts', 'scripts/*.ts'],
    },

    // ── Libs ──
    'libs/api-client': {
      entry: ['openapi-ts.config.ts'],
      // Generated code — exports are intentionally broad (full API surface)
      ignore: ['src/generated/**'],
      ignoreDependencies: [],
    },
    'libs/auth': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/crypto-service': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/database': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/design-system': {
      entry: ['demo/{main.tsx,vite.config.ts}'],
      project: ['src/**/*.{ts,tsx}', 'demo/**/*.{ts,tsx}'],
    },
    'libs/diary-service': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/models': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/mcp-auth-proxy': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/observability': {
      entry: ['__tests__/**/*.spec.ts'],
      ignoreDependencies: [
        // Used as pino transport targets (string references, not imports)
        'pino-opentelemetry-transport',
        'pino-pretty',
      ],
    },
  },
};

export default config;
