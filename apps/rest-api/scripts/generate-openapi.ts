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
  const outputPath =
    process.argv[2] ||
    resolve(__dirname, '..', '..', '..', 'libs', 'api-client', 'openapi.json');

  const app = await buildApp({
    diaryService: createStubService() as never,
    diaryRepository: createStubService() as never,
    agentRepository: createStubService() as never,
    cryptoService: createStubService() as never,
    voucherRepository: createStubService() as never,
    signingRequestRepository: createStubService() as never,
    dataSource: createStubService() as never,
    permissionChecker: createStubService() as never,
    tokenValidator: createStubService() as never,
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
  const json = JSON.stringify(spec, null, 2);
  writeFileSync(outputPath, json);

  // Also write to the landing page public directory
  const landingPublicPath = resolve(
    __dirname,
    '..',
    '..',
    'landing',
    'public',
    'openapi.json',
  );
  mkdirSync(dirname(landingPublicPath), { recursive: true });
  writeFileSync(landingPublicPath, json);

  await app.close();

  console.log(`OpenAPI spec written to ${outputPath}`);
  console.log(`OpenAPI spec written to ${landingPublicPath}`);
}

main().catch((err) => {
  console.error('Failed to generate OpenAPI spec:', err);
  process.exit(1);
});
