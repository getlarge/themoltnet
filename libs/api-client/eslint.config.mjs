import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  { ignores: ['src/generated-api-bindings/**'] },
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      // Build-time only: both OpenAPI configs and the API bindings template
      // use the generator, but generated runtime code does not.
      '@hey-api/openapi-ts',
    ],
  }),
];
