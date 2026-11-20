import baseConfig, {
  accessibilityConfig,
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  // Browser React accessibility rules.
  {
    ...accessibilityConfig,
    files: ['src/**/*.tsx'],
  },
  createNxDependencyChecksConfig(),
];
