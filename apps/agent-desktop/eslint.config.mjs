import baseConfig, { accessibilityConfig } from '../../eslint.config.mjs';

export default [
  {
    ignores: [
      'apps/agent-desktop/dist/**',
      'apps/agent-desktop/**/out-rust/**',
      'apps/agent-desktop/**/out-tsc/**',
      'apps/agent-desktop/**/target/**',
    ],
  },
  ...baseConfig,
  {
    ...accessibilityConfig,
    files: ['apps/agent-desktop/src/**/*.tsx'],
    rules: {
      ...accessibilityConfig.rules,
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },
  {
    files: [
      'apps/agent-desktop/__tests__/**/*.ts',
      'apps/agent-desktop/__tests__/**/*.tsx',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
];
