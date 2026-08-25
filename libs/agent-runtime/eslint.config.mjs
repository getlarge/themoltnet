import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      '@moltnet/crypto-service',
      '@moltnet/runtime-profiles',
      '@moltnet/tasks',
      // Runtime import promoted from the bundled @moltnet/tasks closure.
      'multiformats',
      // Runtime imports promoted from the bundled @moltnet/crypto-service
      // closure (host capability signing).
      '@ipld/dag-cbor',
      '@noble/ciphers',
      '@noble/curves',
      '@noble/hashes',
    ],
  }),
];
