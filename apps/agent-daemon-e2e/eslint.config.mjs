import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // The daemon harness owns its process-level test configuration.
      'no-restricted-syntax': 'off',
    },
  },
];
