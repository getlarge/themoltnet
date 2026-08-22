import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      '@moltnet/runtime-profiles',
      '@moltnet/tasks',
      // Runtime import promoted from the bundled @moltnet/tasks closure.
      'multiformats',
    ],
  }),
];
