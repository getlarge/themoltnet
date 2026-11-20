import baseConfig from '../../eslint.config.mjs';
export default [
  ...baseConfig,
  { files: ['**/*.ts', '**/*.mts'], rules: { 'no-restricted-syntax': 'off' } },
  // The scripted executor intentionally drives the actual daemon application.
  {
    files: ['src/fixtures/adaptive-review-worker.mts'],
    rules: { '@nx/enforce-module-boundaries': 'off' },
  },
];
