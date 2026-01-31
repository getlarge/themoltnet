/**
 * Generate OpenAPI spec from the REST API route definitions.
 *
 * Usage: npx tsx scripts/generate-openapi.ts [output-path]
 *
 * This boots the Fastify app with stub services (no real DB connection needed),
 * calls app.swagger() to extract the OpenAPI spec, and writes it to disk.
 */

import { writeFileSync } from 'node:fs';
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
    agentRepository: createStubService() as never,
    cryptoService: createStubService() as never,
    permissionChecker: createStubService() as never,
  });

  await app.ready();

  const spec = app.swagger();
  writeFileSync(outputPath, JSON.stringify(spec, null, 2));

  await app.close();

  console.log(`OpenAPI spec written to ${outputPath}`);
}

main().catch((err) => {
  console.error('Failed to generate OpenAPI spec:', err);
  process.exit(1);
});
