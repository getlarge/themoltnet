/**
 * Generate OpenAPI and optional response serializers from the REST API routes.
 *
 * Usage: npx tsx scripts/generate-openapi.ts [openapi-path] [serializers-path]
 *
 * This boots the Fastify app with stub services (no real DB connection needed),
 * calls app.swagger() to extract the OpenAPI spec, and writes it to disk.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../src/app.js';
import { createSerializerArtifactBuilder } from './serializer-artifact-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const defaultOutputPath = resolve(__dirname, '..', 'public', 'openapi.json');

/**
 * Recursively sort object keys so the serialized spec is deterministic and
 * matches release-please's `extra-files` JSON updater output byte-for-byte.
 *
 * release-please bumps `$.info.version` by reparsing and re-serializing the
 * whole file with `JSON.stringify(data, null, 2)` (no key reordering, no array
 * collapse). If `generate` emitted a different shape, the committed spec would
 * drift from the release commit and CI's OpenAPI gate would fail on every
 * release. By emitting the same sorted `JSON.stringify(_, 2)` here — and NOT
 * running Prettier on the file (it is in `.prettierignore`) — the three
 * writers (this script, release-please, the committed file) agree exactly.
 * See diary incident c72108c8.
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

async function main() {
  const outputPath = process.argv[2] || defaultOutputPath;

  const serializersPath = process.argv[3];
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

  console.log(`OpenAPI spec written to ${outputPath}`);
}

// Imported SDK modules can leave background timers. All output is written
// synchronously and the app is closed before this build-only process exits.
main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error('Failed to generate route artifacts:', err);
    process.exit(1);
  },
);
