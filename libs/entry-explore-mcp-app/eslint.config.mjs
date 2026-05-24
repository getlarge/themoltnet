import baseConfig from '../../eslint.config.mjs';
import nxPlugin from '@nx/eslint-plugin';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    plugins: {
      '@nx': nxPlugin,
    },
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vite.config.{js,ts,mjs,mts}',
          ],
          // @moltnet/diary-ui is genuinely used (EntryCard JSX in ZoneView.tsx
          // plus type imports elsewhere), but @nx/dependency-checks' npm-usage
          // scanner under-counts source-export workspace libs consumed only via
          // .tsx value imports + type-only imports, producing a false "not
          // used" obsolete-dependency error. Vite inlines it at build time.
          ignoredDependencies: ['@moltnet/diary-ui'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
