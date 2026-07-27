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
];
