import playwright from 'eslint-plugin-playwright';
import baseConfig from '../../eslint.config.mjs';

export default [
  playwright.configs['flat/recommended'],
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // Playwright setup is the configuration boundary and runs in Node even
      // though it exercises the browser-tagged console project.
      '@nx/enforce-module-boundaries': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'no-restricted-syntax': 'off',
    },
  },
];
