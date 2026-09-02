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
      // This build-time generator is not imported by either published entry;
      // its small generated client is bundled so runtime dependencies stay empty.
      '@hey-api/openapi-ts',
    ],
  }),
];
