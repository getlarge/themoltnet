import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // E2E harness code legitimately reads infra connection details from the
      // environment (the Compose stack is out of process); there is no config
      // module to route through here.
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['src/app-factories.e2e.test.ts'],
    rules: {
      // This integration suite intentionally crosses app boundaries to execute
      // the actual registered workflow factories against real Absurd storage.
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
