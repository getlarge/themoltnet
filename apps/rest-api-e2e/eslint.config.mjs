import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // E2E setup is the configuration boundary and intentionally composes
      // server, client, and infrastructure projects.
      '@nx/enforce-module-boundaries': 'off',
      'no-restricted-syntax': 'off',
    },
  },
];
