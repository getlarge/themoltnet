import nxPlugin from '@nx/eslint-plugin';
import baseConfig, { moduleBoundaryOptions } from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    plugins: { '@nx': nxPlugin },
    rules: {
      // This harness owns process configuration and imports only the apps under test.
      'no-restricted-syntax': 'off',
      '@nx/enforce-module-boundaries': [
        'error',
        {
          ...moduleBoundaryOptions,
          allow: ['@themoltnet/agent-daemon/**', '@moltnet/agent-desktop/**'],
          depConstraints: [
            ...moduleBoundaryOptions.depConstraints,
            {
              sourceTag: 'type:e2e',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
];
