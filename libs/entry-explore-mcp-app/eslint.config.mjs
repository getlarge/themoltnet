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
    // @moltnet/diary-ui is genuinely used (EntryCard JSX in ZoneView.tsx plus
    // type imports elsewhere), but @nx/dependency-checks' npm-usage scanner
    // under-counts source-export workspace libs consumed only via .tsx value
    // imports + type-only imports, producing a false obsolete-dependency error.
    // Vite inlines it at build time.
    ignoredDependencies: ['@moltnet/diary-ui'],
  }),
];
