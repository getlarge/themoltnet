import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // The daemon harness intentionally imports app internals and owns its
      // process-level test configuration.
      '@nx/enforce-module-boundaries': 'off',
      'no-restricted-syntax': 'off',
    },
  },
];
