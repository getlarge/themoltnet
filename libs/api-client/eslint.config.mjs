import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  { ignores: ['src/generated-transport/**'] },
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      // Build-time only: both OpenAPI configs and the custom transport client
      // template use the generator, but generated runtime code does not.
      '@hey-api/openapi-ts',
    ],
  }),
];
