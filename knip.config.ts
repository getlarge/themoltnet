import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: ['dist/**', '**/dist/**'],
  // Infrastructure files are not imported but are used externally
  ignoreFiles: ['infra/**'],

  workspaces: {
    'libs/crypto-service': {
      entry: ['__tests__/**/*.test.ts'],
    },
    'libs/database': {
      entry: ['{src/index,drizzle.config}.ts'],
    },
    'libs/design-system': {
      entry: ['demo/{main.tsx,vite.config.ts}'],
      project: ['src/**/*.{ts,tsx}', 'demo/**/*.{ts,tsx}'],
    },
    'libs/observability': {
      entry: ['__tests__/**/*.test.ts'],
    },
  },
};

export default config;
