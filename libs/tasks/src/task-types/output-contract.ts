import { type TSchema, Type } from 'typebox';

/** Stored task field; the daemon validates the schema before execution. */
export const OutputContract = Type.Object(
  {
    version: Type.Literal(1),
    schema: Type.Unknown(),
  },
  { $id: 'OutputContract', additionalProperties: false },
);

/**
 * Project a TypeBox review-result schema onto the intentionally small JSON
 * Schema subset accepted by freeform output contracts. Local validation keeps
 * constraints such as string patterns that this transport cannot express.
 */
export function reviewResultContractSchema(
  schema: TSchema,
): Record<string, unknown> {
  const source = schema as Record<string, unknown>;
  if ('const' in source) {
    const value = source.const;
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error('review result literals must be primitive values');
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
        'review result unions must contain literals of one primitive type',
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
          reviewResultContractSchema(child),
        ]),
      ),
      required: source.required ?? [],
      additionalProperties: false,
    };
  }
  if (type === 'array') {
    const result: Record<string, unknown> = {
      type,
      items: reviewResultContractSchema(source.items as TSchema),
    };
    for (const key of ['minItems', 'maxItems']) {
      if (source[key] !== undefined) result[key] = source[key];
    }
    return result;
  }
  if (!['string', 'number', 'integer', 'boolean'].includes(type as string)) {
    throw new Error(`unsupported review result schema type ${String(type)}`);
  }
  const result: Record<string, unknown> = { type };
  for (const key of ['minLength', 'maxLength', 'minimum', 'maximum']) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}
