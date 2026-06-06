import jsxA11y from 'eslint-plugin-jsx-a11y';

import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  // Browser React accessibility rules. Ink CLI components render to terminal
  // output, so DOM-oriented jsx-a11y rules do not apply there.
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/cli/**/*.tsx'],
    plugins: {
      'jsx-a11y': jsxA11y,
    },
    languageOptions: jsxA11y.flatConfigs.recommended.languageOptions,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
];
