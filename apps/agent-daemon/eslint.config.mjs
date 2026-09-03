import baseConfig, {
  createNxDependencyChecksConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  createNxDependencyChecksConfig({
    ignoredDependencies: [
      // Private workspace packages are build inputs bundled into dist, not
      // installable runtime dependencies.
      '@moltnet/crypto-service',
      '@moltnet/execution-integrations',
      '@moltnet/execution-plan',
      '@moltnet/runtime-profiles',
      '@moltnet/tasks',
      // Runtime dependencies reached through public package/plugin boundaries
      // or bundled private workspace packages; Nx's static project graph
      // cannot see these indirect edges.
      '@earendil-works/gondolin',
      // Imported through the pi-ai OAuth subpath, which the static project
      // graph does not attribute to its package manifest.
      '@earendil-works/pi-ai',
      // Registered by the bundled @moltnet/loopback-companion security
      // profile (serve supervisor); the published bundle needs them
      // installable.
      '@fastify/cors',
      '@fastify/helmet',
      // Used only by the deterministic OpenAPI generator, not the shipped
      // daemon entry graph.
      '@fastify/swagger',
      '@earendil-works/pi-coding-agent',
      '@fastify/otel',
      '@ipld/dag-cbor',
      '@noble/ciphers',
      '@noble/curves',
      '@noble/ed25519',
      '@noble/hashes',
      '@opentelemetry/instrumentation',
      '@opentelemetry/instrumentation-dns',
      '@opentelemetry/instrumentation-http',
      '@opentelemetry/instrumentation-net',
      '@opentelemetry/instrumentation-pg',
      '@opentelemetry/instrumentation-pino',
      '@opentelemetry/instrumentation-runtime-node',
      '@opentelemetry/instrumentation-undici',
      '@themoltnet/os-keyring',
      'fastify-plugin',
      'multiformats',
      // Reached only through the bundled @moltnet/tasks schemas since the
      // profile resolver moved to @themoltnet/agent-runtime; the published
      // bundle guard still requires it in the manifest.
      'typebox',
      'pino-opentelemetry-transport',
      // Loaded by name through pino's transport API rather than an ESM import,
      // so Nx cannot discover the runtime edge from the project graph.
      'pino-pretty',
    ],
  }),
];
