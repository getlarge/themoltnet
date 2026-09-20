import jsxA11y from 'eslint-plugin-jsx-a11y';

import baseConfig from '../../eslint.config.mjs';

export default [
  {
    ignores: [
      'apps/agent-desktop/dist/**',
      'apps/agent-desktop/dist-e2e/**',
      'apps/agent-desktop/**/out-rust/**',
      'apps/agent-desktop/**/out-tsc/**',
      'apps/agent-desktop/**/target/**',
    ],
  },
  ...baseConfig,
  {
    files: ['apps/agent-desktop/src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    languageOptions: jsxA11y.flatConfigs.recommended.languageOptions,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },
  {
    files: [
      'apps/agent-desktop/src/**/*.test.ts',
      'apps/agent-desktop/src/**/*.test.tsx',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
];
