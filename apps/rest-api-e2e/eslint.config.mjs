import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // E2E setup owns its process-level test configuration.
      'no-restricted-syntax': 'off',
    },
  },
];
