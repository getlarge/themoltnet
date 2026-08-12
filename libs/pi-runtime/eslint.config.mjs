import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      '@earendil-works/pi-ai',
      '@moltnet/crypto-service',
      // Private workspace package bundled into the published Vite output.
      '@moltnet/tasks',
      // Runtime imports promoted from bundled private workspace packages.
      '@ipld/dag-cbor',
      '@noble/curves',
      '@noble/ed25519',
      '@noble/hashes',
      'multiformats',
      // Dynamically imported by @themoltnet/sdk/node for OS keyring
      // secret resolution; not directly imported by this package.
      '@themoltnet/os-keyring',
    ],
  }),
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      'no-restricted-syntax': 'off',
    },
  },
];
