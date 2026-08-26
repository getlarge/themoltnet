import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

import { type ScenarioCatalog, ScenarioCatalogSchema } from './types.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SCENARIO_CATALOG_PATH = path.resolve(
  moduleDirectory,
  '../../test-fixtures/sandbox-policy/scenarios.json',
);

function formatErrors(schema: TSchema, value: unknown): string {
  return [...Value.Errors(schema, value)]
    .map((error) => `${error.instancePath || '/'}: ${error.message}`)
    .join('; ');
}

export function parseScenarioCatalog(value: unknown): ScenarioCatalog {
  if (!Value.Check(ScenarioCatalogSchema, value)) {
    throw new Error(
      `scenario catalog failed schema validation: ${formatErrors(ScenarioCatalogSchema, value)}`,
    );
  }
  const ids = new Set<string>();
  for (const scenario of value.scenarios) {
    if (!scenario.id.startsWith(`${scenario.domain}.`)) {
      throw new Error(
        `${scenario.id}: scenario id prefix must match domain ${scenario.domain}`,
      );
    }
    if (ids.has(scenario.id)) {
      throw new Error(`duplicate scenario id: ${scenario.id}`);
    }
    ids.add(scenario.id);
  }
  return value;
}

export async function loadScenarioCatalog(
  catalogPath = DEFAULT_SCENARIO_CATALOG_PATH,
): Promise<ScenarioCatalog> {
  const raw = await readFile(catalogPath, 'utf8');
  return parseScenarioCatalog(JSON.parse(raw) as unknown);
}
