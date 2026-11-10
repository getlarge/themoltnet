import SerializerSelector from '@fastify/fast-json-stringify-compiler';

type SerializerFactory = ReturnType<typeof SerializerSelector>;
type SerializerCompiler = ReturnType<SerializerFactory>;

/**
 * Reuse response serializers across routes with the same JSON schema and
 * schema scope. Fastify's default compiler only uses the schema, not the route
 * URL, method or status. In particular, every error response can share its
 * ProblemDetails serializer instead of rebuilding the entire reference graph.
 *
 * Keep the cache per app and separate schemas/options between encapsulated
 * plugins: an identical $ref can resolve differently in a child scope.
 */
export function createSerializerCompilerFactory(): SerializerFactory {
  const build = SerializerSelector();
  const scopes = new Map<
    Parameters<SerializerFactory>[1],
    Map<string, SerializerCompiler>
  >();

  return (externalSchemas, options) => {
    let schemas = scopes.get(options);
    if (!schemas) {
      schemas = new Map();
      scopes.set(options, schemas);
    }
    const scopeKey = JSON.stringify(externalSchemas ?? {});
    const existing = schemas.get(scopeKey);
    if (existing) return existing;

    const serializers = new Map<
      string | undefined,
      ReturnType<SerializerCompiler>
    >();
    const compiler: SerializerCompiler = (route) => {
      const key = JSON.stringify(route.schema);
      const cached = serializers.get(key);
      if (cached) return cached;
      // The upstream compiler removes a root $id from its reference map.
      // Start each cache miss with the original map so compiling a named
      // schema cannot break a later response that references that same $id.
      const serializer = build(externalSchemas, options)(route);
      serializers.set(key, serializer);
      return serializer;
    };
    schemas.set(scopeKey, compiler);
    return compiler;
  };
}
