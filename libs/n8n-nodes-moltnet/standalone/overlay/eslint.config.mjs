import { config as n8nConfig } from '@n8n/node-cli/eslint';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'out-tsc/**',
      'scripts/**',
      'vendor/**',
    ],
  },
  ...n8nConfig,
];
