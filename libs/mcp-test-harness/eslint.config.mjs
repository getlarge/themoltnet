import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    rules: {
      // The harness is itself the e2e configuration boundary.
      'no-restricted-syntax': 'off',
    },
  },
];
