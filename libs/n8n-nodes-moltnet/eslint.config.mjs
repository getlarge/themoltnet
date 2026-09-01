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
      // n8n loads community nodes with require(); the SDK is deliberately
      // bundled from devDependencies so the published package stays standalone.
      '@themoltnet/sdk',
    ],
  }),
];
