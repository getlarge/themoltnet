/**
 * Generate OpenAPI spec from the REST API route definitions.
 *
 * Usage: npx tsx scripts/generate-openapi.ts [output-path]
 *
 * This boots the Fastify app with stub services (no real DB connection needed),
 * calls app.swagger() to extract the OpenAPI spec, and writes it to disk.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../src/app.js';

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

  const app = await buildApp({
    diaryService: createStubService() as never,
    diaryRepository: createStubService() as never,
    agentRepository: createStubService() as never,
    cryptoService: createStubService() as never,
    voucherRepository: createStubService() as never,
    signingRequestRepository: createStubService() as never,
    nonceRepository: createStubService() as never,
    dataSource: createStubService() as never,
    transactionRunner: createStubService() as never,
    embeddingService: createStubService() as never,
    permissionChecker: createStubService() as never,
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
      rateLimitEmbedding: 20,
      rateLimitVouch: 10,
      rateLimitSigning: 5,
      rateLimitRecovery: 5,
      rateLimitPublicVerify: 10,
      rateLimitPublicSearch: 15,
    },
  });

  await app.ready();

  const spec = app.swagger();
  // Sort keys + trailing newline so output matches release-please's serializer
  // exactly. Do NOT post-process with Prettier (see sortKeysDeep + .prettierignore).
  const json = JSON.stringify(sortKeysDeep(spec), null, 2) + '\n';
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, json);

  await app.close();

  console.log(`OpenAPI spec written to ${outputPath}`);
}

main().catch((err) => {
  console.error('Failed to generate OpenAPI spec:', err);
  process.exit(1);
});
