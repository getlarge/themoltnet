import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      // SDK's Node adapter loads the optional keyring package dynamically.
      '@themoltnet/os-keyring',
    ],
  }),
];
