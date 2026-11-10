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

import { buildSchemaApp } from './schema-app.js';

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

async function main() {
  const outputPath = process.argv[2] || defaultOutputPath;

  const app = await buildSchemaApp();

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
