import { type TSchema, Type } from 'typebox';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keep proposer schemas bounded and within Pi's strict tool subset. */
export function validateOutputContractSchema(schema: unknown): string | null {
  if (!isObject(schema) || schema.type !== 'object') {
    return 'outputContract.schema must be a JSON Schema object with type "object"';
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(schema);
  } catch {
    return 'outputContract.schema must be JSON serializable';
  }
  if (encoded.length > 16_384) {
    return 'outputContract.schema must be at most 16 KiB';
  }
  let nodes = 0;
  const visit = (node: unknown, path: string, depth: number): string | null => {
    if (!isObject(node) || depth > 10 || ++nodes > 200) {
      return `${path} must be a schema object within the depth and size limits`;
    }
    const type = node.type;
    if (
      !['object', 'array', 'string', 'number', 'integer', 'boolean'].includes(
        type as string,
      )
    ) {
      return `${path}.type must be object, array, string, number, integer, or boolean`;
    }
    const common = ['type', 'description', 'title', 'enum'];
    const specific =
      type === 'object'
        ? ['properties', 'required', 'additionalProperties']
        : type === 'array'
          ? ['items', 'minItems', 'maxItems']
          : type === 'string'
            ? ['minLength', 'maxLength']
            : type === 'number' || type === 'integer'
              ? ['minimum', 'maximum']
              : [];
    const unknownKey = Object.keys(node).find(
      (key) => !common.includes(key) && !specific.includes(key),
    );
    if (unknownKey) return `${path}.${unknownKey} is not supported`;
    if (
      node.description !== undefined &&
      typeof node.description !== 'string'
    ) {
      return `${path}.description must be a string`;
    }
    if (node.title !== undefined && typeof node.title !== 'string') {
      return `${path}.title must be a string`;
    }
    if (
      node.enum !== undefined &&
      (type === 'object' ||
        type === 'array' ||
        !Array.isArray(node.enum) ||
        node.enum.length === 0 ||
        node.enum.some((value) =>
          type === 'integer' ? !Number.isInteger(value) : typeof value !== type,
        ))
    ) {
      return `${path}.enum must contain values of the declared primitive type`;
    }
    if (type === 'object') {
      if (!isObject(node.properties) || node.additionalProperties !== false) {
        return `${path} needs properties and additionalProperties: false`;
      }
      const keys = Object.keys(node.properties);
      if (
        keys.length > 50 ||
        keys.some((key) =>
          ['__proto__', 'prototype', 'constructor'].includes(key),
        )
      ) {
        return `${path}.properties has too many or reserved keys`;
      }
      if (
        !Array.isArray(node.required) ||
        node.required.some(
          (key) => typeof key !== 'string' || !keys.includes(key),
        ) ||
        new Set(node.required).size !== node.required.length
      ) {
        return `${path}.required must list unique declared properties`;
      }
      for (const key of keys) {
        const error = visit(
          node.properties[key],
          `${path}.properties.${key}`,
          depth + 1,
        );
        if (error) return error;
      }
    } else if (type === 'array') {
      if (!isObject(node.items)) return `${path}.items must be a schema object`;
      for (const key of ['minItems', 'maxItems'] as const) {
        if (
          node[key] !== undefined &&
          (!Number.isInteger(node[key]) ||
            (node[key] as number) < 0 ||
            (node[key] as number) > 100)
        ) {
          return `${path}.${key} must be an integer between 0 and 100`;
        }
      }
      if (
        typeof node.minItems === 'number' &&
        typeof node.maxItems === 'number' &&
        node.minItems > node.maxItems
      ) {
        return `${path}.minItems must not exceed maxItems`;
      }
      return visit(node.items, `${path}.items`, depth + 1);
    } else {
      const bounds =
        type === 'string' ? ['minLength', 'maxLength'] : ['minimum', 'maximum'];
      for (const key of bounds) {
        if (
          node[key] !== undefined &&
          (typeof node[key] !== 'number' ||
            !Number.isFinite(node[key]) ||
            (type === 'string' &&
              (!Number.isInteger(node[key]) || node[key] < 0)))
        ) {
          return `${path}.${key} must be a valid number`;
        }
      }
      const [minKey, maxKey] = bounds;
      if (
        typeof node[minKey] === 'number' &&
        typeof node[maxKey] === 'number' &&
        node[minKey] > node[maxKey]
      ) {
        return `${path}.${minKey} must not exceed ${maxKey}`;
      }
    }
    return null;
  };
  return visit(schema, 'outputContract.schema', 0);
}

export function outputContractResultSchema(input: unknown): TSchema | null {
  if (
    !isObject(input) ||
    !isObject(input.outputContract) ||
    input.outputContract.version !== 1 ||
    validateOutputContractSchema(input.outputContract.schema)
  ) {
    return null;
  }
  return Type.Unsafe(input.outputContract.schema as TSchema);
}
