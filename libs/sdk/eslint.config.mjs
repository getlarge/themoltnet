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
      // Runtime imports promoted from bundled private workspace packages.
      '@ipld/dag-cbor',
      '@napi-rs/keyring',
      'multiformats',
      'typebox',
    ],
  }),
];
