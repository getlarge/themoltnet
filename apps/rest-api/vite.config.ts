import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tsImport } from 'tsx/esm/api';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { restApiOtelExternals } from '../../vite.shared';
import { createSerializerArtifactBuilder } from './scripts/serializer-artifact-builder.js';
import type * as AppModule from './src/app.js';

function routeArtifactsPlugin(): Plugin {
  let migrationBuild = false;
  return {
    name: 'generate-route-artifacts',
    apply: 'build',
    configResolved(config) {
      migrationBuild =
        typeof config.build.ssr === 'string' &&
        config.build.ssr.endsWith('src/migrate.ts');
    },
    async writeBundle({ dir = 'dist' }) {
      if (migrationBuild) return;
      await generateRouteArtifacts(
        resolve(dir, 'openapi.json'),
        resolve(dir, 'response-serializers.cjs'),
      );
    },
  };
}

function rejectBundledDBOSInternals(): Plugin {
  return {
    name: 'reject-bundled-dbos-internals',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const dbosModuleId = output.moduleIds.find((moduleId) =>
          moduleId.replaceAll('\\', '/').includes('/@dbos-inc/'),
        );
        if (dbosModuleId) {
          this.error(
            `${output.fileName} contains bundled DBOS module ${dbosModuleId}. ` +
              'Externalize @dbos-inc/dbos-sdk and @dbos-inc/drizzle-datasource.',
          );
        }
      }
    },
  };
}

/**
 * Match release-please's sorted JSON formatting to avoid spec drift after version
 * bumps. Keep this output out of Prettier (see .prettierignore; diary c72108c8).
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

// Proxy that returns a no-op function for any property access.
// Used as a stub for services that won't be called during spec generation.
function createStubService(): unknown {
  return new Proxy(
    {},
    {
      get: () => () => Promise.resolve(null),
    },
  );
}

export async function generateRouteArtifacts(
  outputPath = fileURLToPath(new URL('./public/openapi.json', import.meta.url)),
  serializersPath?: string,
) {
  // Load the API only when generating artifacts, not during Nx config discovery.
  // tsx resolves workspace source exports and their .js-to-.ts imports.
  const { buildApp } = (await tsImport(
    './src/app.ts',
    import.meta.url,
  )) as typeof AppModule;
  const builder = serializersPath
    ? createSerializerArtifactBuilder()
    : undefined;
  const app = await buildApp({
    diaryService: createStubService() as never,
    diaryEntryRepository: createStubService() as never,
    contextPackRepository: createStubService() as never,
    renderedPackRepository: createStubService() as never,
    contextPackService: createStubService() as never,
    entryRelationRepository: createStubService() as never,
    agentRepository: createStubService() as never,
    humanRepository: createStubService() as never,
    cryptoService: createStubService() as never,
    groupRepository: createStubService() as never,
    projectRepository: createStubService() as never,
    diaryTransferRepository: createStubService() as never,
    runtimeProfileRepository: createStubService() as never,
    runtimeSessionRepository: createStubService() as never,
    runtimeSessionStorage: createStubService() as never,
    taskArtifactRepository: createStubService() as never,
    taskArtifactStorage: createStubService() as never,
    runtimeSlotRepository: createStubService() as never,
    runtimeModelRepository: createStubService() as never,
    runtimePolicyRepository: createStubService() as never,
    runtimePolicySnapshotRepository: createStubService() as never,
    taskRepository: createStubService() as never,
    taskAnalyticsService: createStubService() as never,
    taskService: createStubService() as never,
    signingRequestRepository: createStubService() as never,
    signingCredentialRepository: createStubService() as never,
    nonceRepository: createStubService() as never,
    dataSource: createStubService() as never,
    transactionRunner: createStubService() as never,
    embeddingService: createStubService() as never,
    permissionChecker: createStubService() as never,
    relationshipWriter: createStubService() as never,
    tokenValidator: createStubService() as never,
    teamResolver: createStubService() as never,
    teamRepository: createStubService() as never,
    relationshipReader: createStubService() as never,
    webhookApiKey: 'stub-key-for-spec-generation',
    recoverySecret: 'stub-recovery-secret-16chars',
    oryClients: createStubService() as never,
    security: {
      corsOrigins: 'http://localhost:3000',
      rateLimitGlobalAuth: 100,
      rateLimitGlobalAnon: 30,
      rateLimitTokenIp: 1000,
      rateLimitOauthConsent: 1000,
      rateLimitOauthProvision: 1000,
      rateLimitTokenUpstreamIp: 1000,
      rateLimitEmbedding: 20,
      rateLimitSigning: 5,
      rateLimitAgentKey: 5,
      rateLimitRecovery: 5,
      rateLimitPublicVerify: 10,
      rateLimitPublicSearch: 15,
      rateLimitLegreffierStart: 3,
      rateLimitLegreffierStatus: 120,
      rateLimitRegistration: 5,
      rateLimitReadiness: 12,
      rateLimitGlobalRead: 150,
      rateLimitPreResolveIp: 300,
      rateLimitOauthApprovalIp: 300,
      rateLimitAllowList: ['/health', '/problems'],
      trustProxy: false,
      apiBaseUrl: 'http://localhost:8000',
    },
    hydraPublicUrl: 'http://hydra-mock:4444',
    packGcConfig: {
      PACK_GC_COMPILE_TTL_DAYS: 7,
      PACK_GC_CRON: '0 * * * *',
      PACK_GC_BATCH_SIZE: 100,
    },
    runtimeSessionMaxBytes: 1024 * 1024,
    taskArtifactMaxBytes: 1024 * 1024,
    serializerCompilerFactory: builder?.factory,
  });
  try {
    await app.ready();
    // Match release-please's serializer exactly; do not run Prettier on the spec.
    const json = JSON.stringify(sortKeysDeep(app.swagger()), null, 2) + '\n';
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, json);
    if (builder && serializersPath) {
      mkdirSync(dirname(serializersPath), { recursive: true });
      writeFileSync(serializersPath, builder.source());
    }
  } finally {
    await app.close();
  }
}

export default defineConfig({
  define: { __MOLTNET_PRECOMPILED_SERIALIZERS__: 'true' },
  plugins: [rejectBundledDBOSInternals(), routeArtifactsPlugin()],
  build: {
    // `ssr: true` (not an entry path) so Vite builds every entry in
    // rolldownOptions.input; a string here would override that map. The
    // input map also lets @nx/vite/plugin recognize this as buildable (its
    // isBuildable check does not read build.ssr).
    ssr: true,
    outDir: 'dist',
    rolldownOptions: {
      input: {
        main: 'src/main.ts',
        // Worker thread entry loaded by @moltnet/embedding-service at runtime
        // from `./embedding-worker-thread.js` next to main.js.
        'embedding-worker-thread': fileURLToPath(
          import.meta.resolve('@moltnet/embedding-service/worker-thread'),
        ),
      },
    },
  },
  ssr: {
    // drizzle-orm: ships pure ESM with no default export; Vite's CJS interop
    // incorrectly generates a default import when externalizing it.
    noExternal: ['drizzle-orm'],
    // pino: uses __dirname for worker thread resolution.
    // @opentelemetry: instrumentation hooks use require.cache (CJS-only).
    // Both must stay external so Node resolves them from node_modules.
    external: [
      'pino',
      'pino-worker',
      'pino-pretty',
      'pino-opentelemetry-transport',
      'thread-stream',
      '@fastify/otel',
      '@dbos-inc/dbos-sdk',
      '@dbos-inc/drizzle-datasource',
      ...restApiOtelExternals,
      // onnxruntime-node uses native .node addons loaded via dynamic require().
      // Rollup cannot resolve these at bundle time; must stay external so Node
      // resolves them from node_modules at runtime.
      '@huggingface/transformers',
      'onnxruntime-node',
    ],
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
