import { config as n8nConfig } from '@n8n/node-cli/eslint';

import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

const composableN8nConfig = n8nConfig.filter(
  (entry) => !entry.name?.startsWith('typescript-eslint/'),
);

export default [
  // Both configs include typescript-eslint's recommended preset. Keep the
  // repository instance so ESLint sees one plugin object, while retaining all
  // n8n community, cloud-support, import, credential, node, and package rules.
  ...composableN8nConfig,
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      // The private generated API client is intentionally bundled from
      // devDependencies so the published n8n package has no runtime deps.
      '@moltnet/api-client',
    ],
  }),
];
