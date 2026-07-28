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
  {
    files: ['src/**/*.test.ts'],
    rules: {
      // MCP structuredContent is an untyped JSON protocol boundary in the SDK.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
];
