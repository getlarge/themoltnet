import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['src/**/*.integration.test.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
