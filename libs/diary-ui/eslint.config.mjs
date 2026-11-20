import baseConfig, { accessibilityConfig } from '../../eslint.config.mjs';

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
];
