import baseConfig, {
  accessibilityConfig,
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    ...accessibilityConfig,
    files: ['src/**/*.tsx'],
    rules: {
      ...accessibilityConfig.rules,
      // Retain the existing exception during the lint-engine migration.
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },
  createNxDependencyChecksConfig({
    // Provider contracts are type-only; the UI never ships the generated client.
    ignoredDependencies: ['@moltnet/agent-daemon-api-client'],
  }),
];
