import type {
  JsonSyntaxRepairKind,
  SchemaAlignmentRepairKind,
} from '@moltnet/tasks';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

/** A repair `alignToSchema` made. Executors report a wider `SubmitRepair`. */
export interface SchemaAlignmentRepair {
  kind: SchemaAlignmentRepairKind;
  /** JSON pointer to the value changed; the root is the empty string. */
  path: string;
}

export interface SchemaAlignment {
  value: unknown;
  repairs: SchemaAlignmentRepair[];
}

export interface SchemaAlignmentOptions {
  /** Optional syntax repair for complete JSON strings supplied as tool values. */
  parseJsonString?: (text: string) => {
    value: unknown;
    repairs: JsonSyntaxRepairKind[];
  } | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pointer(path: string, member: string | number): string {
  return `${path}/${String(member).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function valid(schema: TSchema, value: unknown): boolean {
  try {
    return Value.Check(schema, value);
  } catch {
    return false;
  }
}

function admitsJsonType(declared: unknown[], value: unknown): boolean {
  const types = declared.filter((type) => typeof type === 'string');
  if (types.length === 0) return true;
  return types.some((type) => {
    switch (type) {
      case 'null':
        return value === null;
      case 'array':
        return Array.isArray(value);
      case 'object':
        return record(value);
      case 'integer':
        return Number.isInteger(value);
      default:
        return typeof value === type;
    }
  });
}

function align(
  value: unknown,
  schema: TSchema,
  path: string,
  options: SchemaAlignmentOptions,
): SchemaAlignment {
  if (valid(schema, value)) return { value, repairs: [] };
  const shape = schema as Record<string, unknown>;

  const alternatives = [shape.anyOf, shape.oneOf].find(Array.isArray) as
    | TSchema[]
    | undefined;
  if (alternatives) {
    const candidates = alternatives.map((member) =>
      align(value, member, path, options),
    );
    const passing = candidates.filter((candidate) =>
      valid(schema, candidate.value),
    );
    if (passing.length > 0) {
      return passing.reduce((best, candidate) =>
        candidate.repairs.length < best.repairs.length ? candidate : best,
      );
    }
    return { value, repairs: [] };
  }

  const declared = Array.isArray(shape.type) ? shape.type : [shape.type];
  const admitsString = declared.includes('string');
  let current = value;
  const repairs: SchemaAlignmentRepair[] = [];

  if (typeof current === 'string' && !admitsString) {
    try {
      const parsed = options.parseJsonString?.(current) ?? {
        value: JSON.parse(current) as unknown,
        repairs: [],
      };
      // A decode must produce a value of a declared JSON type. Otherwise a
      // string such as "null" becomes null and a later coercion step can turn
      // it into 0, false or "". Array targets validate their own wrapping.
      if (
        typeof parsed.value !== 'string' &&
        (shape.type === 'array' || admitsJsonType(declared, parsed.value))
      ) {
        current = parsed.value;
        repairs.push({ kind: 'json_string', path });
        repairs.push(...parsed.repairs.map((kind) => ({ kind, path })));
      }
    } catch {
      // Strict validation reports the original value.
    }
  }

  if (shape.type === 'array') {
    if (!Array.isArray(current)) {
      current = [current];
      repairs.push({ kind: 'single_to_array', path });
    }
    const items = shape.items as TSchema | undefined;
    if (items) {
      const aligned = (current as unknown[]).map((item, index) =>
        align(item, items, pointer(path, index), options),
      );
      current = aligned.map((item) => item.value);
      repairs.push(...aligned.flatMap((item) => item.repairs));
    }
    // A malformed scalar is not a repaired array merely because it was
    // wrapped. Keep the original value for strict validation in that case.
    if (!Array.isArray(value) && !valid(schema, current)) {
      return { value, repairs: [] };
    }
  } else if (shape.type === 'object' && record(current)) {
    const properties = record(shape.properties) ? shape.properties : {};
    if (
      Object.keys(current).length === 1 &&
      Object.hasOwn(current, 'output') &&
      !Object.hasOwn(properties, 'output') &&
      record(current.output)
    ) {
      current = current.output;
      repairs.push({ kind: 'output_envelope', path });
    }
    if (record(current)) {
      const result = { ...current };
      const required = Array.isArray(shape.required) ? shape.required : [];
      for (const [key, child] of Object.entries(result)) {
        const property = properties[key];
        if (!record(property)) continue;
        if (
          child === null &&
          !required.includes(key) &&
          !valid(property as TSchema, null)
        ) {
          delete result[key];
          repairs.push({ kind: 'optional_null', path: pointer(path, key) });
          continue;
        }
        const aligned = align(
          child,
          property as TSchema,
          pointer(path, key),
          options,
        );
        result[key] = aligned.value;
        repairs.push(...aligned.repairs);
      }
      current = result;
    }
  }

  if (typeof current === 'string') {
    const stringValue = current;
    const choices: unknown[] = Array.isArray(shape.enum)
      ? (shape.enum as unknown[])
      : Object.hasOwn(shape, 'const')
        ? [shape.const]
        : [];
    const match = choices.find(
      (choice) =>
        typeof choice === 'string' &&
        choice.toLowerCase() === stringValue.toLowerCase(),
    );
    if (match !== undefined && match !== current) {
      current = match;
      repairs.push({ kind: 'case_insensitive_match', path });
    }
  }

  // Partial repairs are kept even when the node is still invalid, so strict
  // validation reports the remaining field-level error rather than the
  // original encoding. Only accepted submissions emit repair telemetry.
  return { value: current, repairs };
}

/** Cheap, synchronous syntax alignment. Strict task validation remains final. */
export function alignToSchema(
  value: unknown,
  schema: TSchema,
  options: SchemaAlignmentOptions = {},
): SchemaAlignment {
  return align(value, schema, '', options);
}
