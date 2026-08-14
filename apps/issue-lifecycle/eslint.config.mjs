import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      // Private workspace packages are build inputs bundled into dist.
      '@moltnet/crypto-service',
      '@moltnet/tasks',
      // Runtime imports promoted from the bundled crypto/task closure.
      '@ipld/dag-cbor',
      '@noble/curves',
      '@noble/ed25519',
      '@noble/hashes',
      'multiformats',
      // SDK's Node adapter loads the optional keyring package dynamically.
      '@themoltnet/os-keyring',
    ],
  }),
];
