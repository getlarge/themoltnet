/**
 * TypeBox schemas for `@modelcontextprotocol/server`.
 *
 * The official server accepts Standard Schema (`StandardSchemaWithJSON`) for
 * tool input and output. TypeBox schemas are plain JSON Schema, so they go
 * through the SDK's `fromJsonSchema` unchanged, validated by TypeBox's own
 * compiler instead of the SDK default. Handler arguments stay typed as
 * `Static<typeof Schema>`.
 */
import {
  fromJsonSchema,
  type JsonSchemaType,
  type jsonSchemaValidator,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import type { Static, TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

type CompiledValidator = ReturnType<typeof Compile>;

// The server is built per request (stateless transport), so the same schema
// object reaches `getValidator` on every request. Compile each one once.
const compiled = new WeakMap<object, CompiledValidator>();

function compile(schema: TSchema): CompiledValidator {
  let validator = compiled.get(schema);
  if (!validator) {
    validator = Compile(schema);
    compiled.set(schema, validator);
  }
  return validator;
}

function formatErrors(validator: CompiledValidator, input: unknown): string {
  return validator
    .Errors(input)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

/** `jsonSchemaValidator` backed by TypeBox's compiler. */
export const typeboxValidator: jsonSchemaValidator = {
  getValidator<T>(schema: JsonSchemaType) {
    const validator = compile(schema as TSchema);
    return (input: unknown) =>
      validator.Check(input)
        ? { valid: true as const, data: input as T, errorMessage: undefined }
        : {
            valid: false as const,
            data: undefined,
            errorMessage: formatErrors(validator, input),
          };
  },
};

const adapted = new WeakMap<object, StandardSchemaWithJSON>();

/**
 * Adapt a TypeBox schema for `registerTool`'s `inputSchema` / `outputSchema`.
 * Repeated calls with the same schema return the same adapter.
 */
export function typebox<T extends TSchema>(
  schema: T,
): StandardSchemaWithJSON<Static<T>, Static<T>> {
  let standard = adapted.get(schema);
  if (!standard) {
    standard = fromJsonSchema<Static<T>>(
      schema as unknown as JsonSchemaType,
      typeboxValidator,
    );
    adapted.set(schema, standard);
  }
  return standard as StandardSchemaWithJSON<Static<T>, Static<T>>;
}
