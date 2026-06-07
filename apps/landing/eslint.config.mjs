import jsxA11y from 'eslint-plugin-jsx-a11y';

import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['src/**/*.tsx'],
    plugins: {
      'jsx-a11y': jsxA11y,
    },
    languageOptions: jsxA11y.flatConfigs.recommended.languageOptions,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // eslint-plugin-jsx-a11y 6.10.2 crashes this rule under ESLint 9 with
      // the current minimatch package shape. Keep the rest of recommended on.
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },
];
