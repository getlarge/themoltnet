import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ControlDomain,
  SandboxScenario,
  ScenarioCatalog,
} from './types.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SCENARIO_CATALOG_PATH = path.resolve(
  moduleDirectory,
  '../../test-fixtures/sandbox-policy/scenarios.json',
);

const DOMAINS = new Set<ControlDomain>([
  'filesystem',
  'network',
  'credential',
  'lifecycle',
  'resource',
  'topology',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseScenario(value: unknown, index: number): SandboxScenario {
  if (!isRecord(value)) {
    throw new Error(`scenario ${index} must be an object`);
  }
  const { id, domain, control, purpose, required, oracle } = value;
  if (typeof id !== 'string' || !/^[a-z]+\.[a-z0-9-]+$/.test(id)) {
    throw new Error(`scenario ${index} has an invalid id`);
  }
  if (typeof domain !== 'string' || !DOMAINS.has(domain as ControlDomain)) {
    throw new Error(`scenario ${id} has an invalid domain`);
  }
  for (const [name, field] of [
    ['control', control],
    ['purpose', purpose],
    ['oracle', oracle],
  ] as const) {
    if (typeof field !== 'string' || field.trim() === '') {
      throw new Error(`scenario ${id} has an invalid ${name}`);
    }
  }
  if (typeof required !== 'boolean') {
    throw new Error(`scenario ${id} has an invalid required flag`);
  }
  return {
    id: id as string,
    domain: domain as ControlDomain,
    control: control as string,
    purpose: purpose as string,
    required,
    oracle: oracle as string,
  };
}

export function parseScenarioCatalog(value: unknown): ScenarioCatalog {
  if (!isRecord(value)) throw new Error('scenario catalog must be an object');
  if (value.schemaVersion !== 1) {
    throw new Error('scenario catalog schemaVersion must be 1');
  }
  if (
    typeof value.catalogVersion !== 'string' ||
    value.catalogVersion.trim() === ''
  ) {
    throw new Error('scenario catalog requires catalogVersion');
  }
  if (typeof value.notice !== 'string' || value.notice.trim() === '') {
    throw new Error('scenario catalog requires a notice');
  }
  if (!Array.isArray(value.scenarios) || value.scenarios.length === 0) {
    throw new Error('scenario catalog requires scenarios');
  }
  const scenarios = value.scenarios.map(parseScenario);
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) {
      throw new Error(`duplicate scenario id: ${scenario.id}`);
    }
    ids.add(scenario.id);
  }
  return {
    schemaVersion: 1,
    catalogVersion: value.catalogVersion,
    notice: value.notice,
    scenarios,
  };
}

export async function loadScenarioCatalog(
  catalogPath = DEFAULT_SCENARIO_CATALOG_PATH,
): Promise<ScenarioCatalog> {
  const raw = await readFile(catalogPath, 'utf8');
  return parseScenarioCatalog(JSON.parse(raw) as unknown);
}
