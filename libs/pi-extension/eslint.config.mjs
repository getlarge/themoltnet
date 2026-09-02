import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      '@earendil-works/pi-ai',
      '@earendil-works/pi-coding-agent',
      '@moltnet/crypto-service',
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
