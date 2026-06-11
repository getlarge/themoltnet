/**
 * Register TypeBox string formats used across Task / TaskOutput / task-type
 * schemas. Import this module for its side effect (the package index does so
 * automatically) before compiling or Check()ing any schema that references
 * `format: 'uuid'` or `format: 'date-time'`.
 *
 * Idempotent: registration is guarded by `Format.Has(...)`.
 */
import * as Format from 'typebox/format';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!Format.Has('uuid')) {
  Format.Set('uuid', (v) => UUID_RE.test(v));
}

if (!Format.Has('date-time')) {
  Format.Set('date-time', (v) => !Number.isNaN(Date.parse(v)));
}
