import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['__tests__/**/*.integration.spec.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
