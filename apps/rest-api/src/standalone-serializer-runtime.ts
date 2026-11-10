import { createRequire } from 'node:module';

export type StandaloneRequire = (id: string) => unknown;

interface ValidatorState {
  ajvOptions: Record<string, unknown>;
  ajvSchemas: Record<string, unknown>;
}

// fast-json-stringify does not publish types for this internal class. Keep
// the boundary limited to the constructor and method this adapter uses.
interface Validator {
  addSchema(schema: unknown, id: string): void;
}

type ValidatorConstructor = new (
  options: ValidatorState['ajvOptions'],
) => Validator;

/** Runtime dependencies used by fast-json-stringify's standalone output. */
export function createStandaloneSerializerRequire(): StandaloneRequire {
  const require = createRequire(import.meta.url);
  // Resolve through the declared compiler dependency so this also works in
  // pnpm's isolated production layout.
  const runtimeRequire = createRequire(
    require.resolve('@fastify/fast-json-stringify-compiler'),
  );
  const Validator = runtimeRequire(
    'fast-json-stringify/lib/validator',
  ) as ValidatorConstructor;

  // FJS 6.2.0's restoreFromState bypasses addSchema, losing its Date/toJSON
  // adaptation for string branches in unions. Use the normal addSchema path
  // until upstream restoration preserves it. The Date parity tests protect
  // this dependency-internal adapter; the shared Validator class is untouched.
  const standaloneValidator = {
    restoreFromState(state: ValidatorState): Validator {
      const validator = new Validator(state.ajvOptions);
      for (const [id, schema] of Object.entries(state.ajvSchemas)) {
        validator.addSchema(schema, id);
      }
      return validator;
    },
  };

  return (id): unknown =>
    id === 'fast-json-stringify/lib/validator'
      ? standaloneValidator
      : runtimeRequire(id);
}
