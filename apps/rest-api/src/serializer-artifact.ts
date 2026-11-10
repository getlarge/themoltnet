import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import type SerializerSelector from '@fastify/fast-json-stringify-compiler';
import { StandaloneSerializer } from '@fastify/fast-json-stringify-compiler';

type Factory = ReturnType<typeof SerializerSelector>;
type Compiler = ReturnType<Factory>;
type Serializer = ReturnType<Compiler>;

export interface SerializerArtifact {
  version: 1;
  scopes: Record<string, Record<string, Serializer>>;
}

// Fingerprint the entire reference scope, not only the root schema: the same
// $ref may resolve differently in an encapsulated Fastify plugin. Reject
// non-JSON options instead of silently giving custom functions the same key.
function fingerprint(value: unknown): string {
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

function scopeKey(...[schemas, options]: Parameters<Factory>): string {
  assertJsonOptions(options);
  return fingerprint([schemas ?? {}, options ?? {}]);
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

export function createPrecompiledSerializerFactory(
  artifact: SerializerArtifact,
): Factory {
  if (artifact.version !== 1) {
    throw new Error('Unsupported serializer artifact version; rebuild the API');
  }
  return (schemas, options) => {
    const scope = artifact.scopes[scopeKey(schemas, options)];
    if (!scope) {
      throw new Error('Serializer artifact scope mismatch; rebuild the API');
    }
    return (route) => {
      const serializer = scope[fingerprint(route.schema)];
      if (!serializer) {
        throw new Error(
          `Missing precompiled serializer for ${route.method} ${route.url} ${route.httpStatus}; rebuild the API`,
        );
      }
      return serializer;
    };
  };
}

export function loadSerializerArtifact(url: URL): Factory {
  const require = createRequire(import.meta.url);
  return createPrecompiledSerializerFactory(
    require(fileURLToPath(url)) as SerializerArtifact,
  );
}

/** Build tooling only; emitted code uses the upstream standalone serializer. */
export function createSerializerArtifactBuilder(): {
  factory: Factory;
  source: () => string;
} {
  const scopes = new Map<string, Map<string, string>>();
  const factory: Factory = (schemas, options) => {
    const key = scopeKey(schemas, options);
    let scope = scopes.get(key);
    if (!scope) {
      scope = new Map();
      scopes.set(key, scope);
    }
    const compiled = new Map<string, Serializer>();
    return (route) => {
      const key = fingerprint(route.schema);
      const existing = compiled.get(key);
      if (existing) return existing;
      // Fresh factory/options on each miss: upstream mutates both options and
      // its $id reference map. Never let generation change the next scope key.
      const serializer = StandaloneSerializer({
        readMode: false,
        storeFunction: (_route, source) => scope.set(key, source),
      })(schemas, { ...options })(route);
      compiled.set(key, serializer);
      return serializer;
    };
  };
  return {
    factory,
    source: () => {
      // Resolve standalone runtime helpers through the declared compiler
      // dependency, including in pnpm's isolated production deploy layout.
      const lines = [
        "'use strict';",
        "const runtimeRequire = require('node:module').createRequire(require.resolve('@fastify/fast-json-stringify-compiler'));",
        'module.exports = { version: 1, scopes: {',
      ];
      for (const [key, serializers] of scopes) {
        lines.push(`${JSON.stringify(key)}: {`);
        for (const [schema, source] of serializers) {
          lines.push(
            `${JSON.stringify(schema)}: (function(require) { const module = { exports: {} }; ${source}\nreturn module.exports; })(runtimeRequire),`,
          );
        }
        lines.push('},');
      }
      lines.push('}};');
      return lines.join('\n');
    },
  };
}
