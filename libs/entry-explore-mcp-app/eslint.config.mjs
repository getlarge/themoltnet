import jsxA11y from 'eslint-plugin-jsx-a11y';

import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

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
  createNxDependencyChecksConfig({
    // @moltnet/diary-ui is genuinely used (EntryCard JSX in ZoneView.tsx plus
    // type imports elsewhere), but @nx/dependency-checks' npm-usage scanner
    // under-counts source-export workspace libs consumed only via .tsx value
    // imports + type-only imports, producing a false obsolete-dependency error.
    // Vite inlines it at build time.
    ignoredDependencies: ['@moltnet/diary-ui'],
  }),
];
