/**
 * Register TypeBox string formats used across Task / TaskOutput / task-type
 * schemas. Import this module for its side effect (the package index does so
 * automatically) before compiling or Check()ing any schema that references
 * `format: 'uuid'` or `format: 'date-time'` — otherwise TypeCompiler reports
 * "Unknown format" and every union containing such a member fails to match.
 *
 * Idempotent: registration is guarded by `FormatRegistry.Has(...)`.
 */
import * as TypeBox from '@sinclair/typebox';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FormatRegistryApi = {
  Has(format: string): boolean;
  Set(format: string, check: (value: string) => boolean): void;
};

function isFormatRegistryApi(registry: unknown): registry is FormatRegistryApi {
  return (
    typeof registry === 'object' &&
    registry !== null &&
    'Has' in registry &&
    'Set' in registry &&
    typeof registry.Has === 'function' &&
    typeof registry.Set === 'function'
  );
}

function getFormatRegistry(): FormatRegistryApi | undefined {
  const registry: unknown = TypeBox.FormatRegistry;

  if (registry === undefined) {
    return undefined;
  }

  if (!isFormatRegistryApi(registry)) {
    throw new TypeError('Invalid TypeBox FormatRegistry export');
  }

  return registry;
}

const FormatRegistry = getFormatRegistry();

if (FormatRegistry) {
  if (!FormatRegistry.Has('uuid')) {
    FormatRegistry.Set('uuid', (v) => UUID_RE.test(v));
  }

  if (!FormatRegistry.Has('date-time')) {
    FormatRegistry.Set('date-time', (v) => !Number.isNaN(Date.parse(v)));
  }
}
