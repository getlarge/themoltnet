import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SignerCeremonyService } from '../src/ceremony-service.js';
import { registerSignerOpenApi } from '../src/openapi.js';
import { createSignerServer } from '../src/server.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultOutputPath = resolve(scriptDirectory, '..', 'openapi.json');

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return sorted;
      }, {});
  }
  return value;
}

function createStubService(): SignerCeremonyService {
  return new Proxy(
    {},
    {
      get: () => () => Promise.resolve(null),
    },
  ) as SignerCeremonyService;
}

async function main(): Promise<void> {
  const outputPath = process.argv[2] || defaultOutputPath;
  const app = createSignerServer(createStubService(), {
    registerOpenApi: registerSignerOpenApi,
  });
  await app.ready();

  const json = `${JSON.stringify(sortKeysDeep(app.swagger()), null, 2)}\n`;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, json);

  await app.close();
  process.stdout.write(
    `Signer companion OpenAPI spec written to ${outputPath}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof Error
      ? `Failed to generate signer companion OpenAPI spec: ${error.stack ?? error.message}\n`
      : `Failed to generate signer companion OpenAPI spec: ${String(error)}\n`,
  );
  process.exitCode = 1;
});
