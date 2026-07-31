import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      '@moltnet/tasks',
      // Runtime imports promoted from the bundled @moltnet/tasks closure.
      'multiformats',
      'typebox',
    ],
  }),
];
