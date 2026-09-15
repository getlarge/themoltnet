import { config as n8nConfig } from '@n8n/node-cli/eslint';

import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

const composableN8nConfig = n8nConfig.filter(
  (entry) => !entry.name?.startsWith('typescript-eslint/'),
);

export default [
  {
    // These files are linted after projection, when vendored imports exist.
    ignores: ['standalone/overlay/**'],
  },
  // Both configs include typescript-eslint's recommended preset. Keep the
  // repository instance so ESLint sees one plugin object, while retaining all
  // n8n community, cloud-support, import, credential, node, and package rules.
  ...composableN8nConfig,
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      // The n8n development CLI is consumed by scripts and ESLint config only.
      '@n8n/node-cli',
      // The private generated API client is intentionally bundled from
      // devDependencies so the published n8n package has no runtime deps.
      '@moltnet/api-client',
    ],
  }),
  {
    files: ['__tests__/**/*.ts'],
    rules: {
      // Release projection tests legitimately exercise Node.js filesystem and
      // process APIs; these rules remain enabled for shipped node code.
      '@n8n/community-nodes/no-dangerous-functions': 'off',
      '@n8n/community-nodes/no-restricted-globals': 'off',
      '@n8n/community-nodes/no-restricted-imports': 'off',
    },
  },
];
