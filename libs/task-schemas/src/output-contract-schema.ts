import type { TSchema } from 'typebox';

/**
 * Project a TypeBox schema onto the small JSON Schema subset accepted by task
 * output contracts. Callers retain their full schema for local validation of
 * constraints such as string patterns that this transport cannot express.
 */
export function toOutputContractSchema(
  schema: TSchema,
): Record<string, unknown> {
  const source = schema as Record<string, unknown>;
  if ('const' in source) {
    const value = source.const;
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error('output contract literals must be primitive values');
    }
    return { type: typeof value, enum: [value] };
  }
  if (Array.isArray(source.anyOf)) {
    const values = source.anyOf.map((member) =>
      member && typeof member === 'object'
        ? (member as Record<string, unknown>).const
        : undefined,
    );
    const kind = typeof values[0];
    if (
      values.length === 0 ||
      !['string', 'number', 'boolean'].includes(kind) ||
      values.some((value) => value === undefined || typeof value !== kind)
    ) {
      throw new Error(
        'output contract unions must contain literals of one primitive type',
      );
    }
    return { type: kind, enum: values };
  }

  const type = source.type;
  if (type === 'object') {
    const properties = source.properties as Record<string, TSchema>;
    return {
      type,
      properties: Object.fromEntries(
        Object.entries(properties).map(([name, child]) => [
          name,
          toOutputContractSchema(child),
        ]),
      ),
      required: source.required ?? [],
      additionalProperties: false,
    };
  }
  if (type === 'array') {
    const result: Record<string, unknown> = {
      type,
      items: toOutputContractSchema(source.items as TSchema),
    };
    for (const key of ['minItems', 'maxItems']) {
      if (source[key] !== undefined) result[key] = source[key];
    }
    return result;
  }
  if (!['string', 'number', 'integer', 'boolean'].includes(type as string)) {
    throw new Error(`unsupported output contract schema type ${String(type)}`);
  }
  const result: Record<string, unknown> = { type };
  for (const key of ['minLength', 'maxLength', 'minimum', 'maximum']) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}
