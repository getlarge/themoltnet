import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerAgentServerOpenApi } from '../src/lib/agent-server/openapi.js';
import { buildAgentServer } from '../src/lib/agent-server/server.js';

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

function stub<T extends object>(): T {
  return new Proxy({} as T, {
    get: () => () => undefined,
  });
}

async function main(): Promise<void> {
  const outputPath = process.argv[2] || defaultOutputPath;
  const app = buildAgentServer({
    store: stub(),
    secrets: stub(),
    secretProviders: stub(),
    externalSecretProviders: stub(),
    pairing: stub(),
    runs: stub(),
    subscriptions: stub(),
    allowedOrigins: ['https://console.themolt.net'],
    defaultApiUrl: 'https://api.themolt.net',
    version: '0.0.0',
    registerOpenApi: registerAgentServerOpenApi,
  });
  await app.ready();

  const json = `${JSON.stringify(sortKeysDeep(app.swagger()), null, 2)}\n`;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, json);

  await app.close();
  process.stdout.write(`Agent Server OpenAPI spec written to ${outputPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof Error
      ? `Failed to generate Agent Server OpenAPI spec: ${error.stack ?? error.message}\n`
      : `Failed to generate Agent Server OpenAPI spec: ${String(error)}\n`,
  );
  process.exitCode = 1;
});
