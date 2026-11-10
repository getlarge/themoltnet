import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import type {
  Serializer,
  SerializerFactory,
} from '@fastify/fast-json-stringify-compiler';

import {
  createStandaloneSerializerRequire,
  type StandaloneRequire,
} from './standalone-serializer-runtime.js';

export interface SerializerArtifact {
  version: 2;
  createScopes: (
    require: StandaloneRequire,
  ) => Record<string, Record<string, Serializer>>;
}

export function createPrecompiledSerializerFactory(
  artifact: SerializerArtifact,
): SerializerFactory {
  if (artifact.version !== 2) {
    throw new Error('Unsupported serializer artifact version; rebuild the API');
  }
  const scopes = artifact.createScopes(createStandaloneSerializerRequire());
  return (schemas, options) => {
    const scope = scopes[serializerScopeKey(schemas, options)];
    if (!scope) {
      throw new Error('Serializer artifact scope mismatch; rebuild the API');
    }
    return (route) => {
      const serializer = scope[serializerSchemaKey(route.schema)];
      if (!serializer) {
        throw new Error(
          `Missing precompiled serializer for ${route.method} ${route.url} ${route.httpStatus}; rebuild the API`,
        );
      }
      return serializer;
    };
  };
}

export function loadSerializerArtifact(url: URL): SerializerFactory {
  const require = createRequire(import.meta.url);
  return createPrecompiledSerializerFactory(
    require(fileURLToPath(url)) as SerializerArtifact,
  );
}

/** Shared by the build collector and runtime lookup to detect schema drift. */
export function serializerSchemaKey(value: unknown): string {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (
      typeof item === 'function' ||
      typeof item === 'symbol' ||
      typeof item === 'bigint' ||
      (typeof item === 'number' && !Number.isFinite(item))
    ) {
      throw new Error(
        'Precompiled serializers require JSON-compatible options',
      );
    }
    return item;
  });
  return createHash('sha256')
    .update(json ?? 'undefined')
    .digest('hex');
}

// A $ref may resolve differently in an encapsulated Fastify plugin. Include
// the entire reference scope and options, not only the response schema.
export function serializerScopeKey(
  schemas: Parameters<SerializerFactory>[0],
  options: Parameters<SerializerFactory>[1],
): string {
  assertJsonOptions(options);
  return serializerSchemaKey([schemas ?? {}, options ?? {}]);
}

function assertJsonOptions(value: unknown): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'object') {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (
      !Array.isArray(value) &&
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw new Error(
        'Precompiled serializers require JSON-compatible options',
      );
    }
    for (const child of Object.values(value)) assertJsonOptions(child);
  } else if (
    !['string', 'number', 'boolean'].includes(typeof value) ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    throw new Error('Precompiled serializers require JSON-compatible options');
  }
}
