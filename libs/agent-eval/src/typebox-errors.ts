/**
 * Shared TypeBox validation-error formatter. Both the scenario reader
 * (`read-scenario.ts`) and the gate output-schema check (`check-gates.ts`)
 * render every error of a value against a schema as one
 * `"<path>: <message>; …"` string; this is the single copy.
 */
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

/** Shape of a typebox v1 validation error we read fields off of. */
interface TypeBoxError {
  instancePath: string;
  message: string;
}

/**
 * Format every validation error of `value` against `schema` as a single
 * semicolon-joined `"<instancePath or '/'>: <message>"` string.
 */
export function formatTypeBoxErrors(schema: TSchema, value: unknown): string {
  return [...Value.Errors(schema, value)]
    .map((raw) => {
      const e = raw as unknown as TypeBoxError;
      return `${e.instancePath || '/'}: ${e.message}`;
    })
    .join('; ');
}
