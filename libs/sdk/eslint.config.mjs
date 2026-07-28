import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      '@moltnet/api-client',
      '@moltnet/crypto-service',
      '@moltnet/tasks',
      'typebox',
    ],
  }),
];
