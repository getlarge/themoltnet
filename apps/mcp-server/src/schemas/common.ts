/**
 * Shared type utilities for deriving MCP input schemas from the
 * generated API client types.
 *
 * Input schemas accept snake_case keys (MCP convention) and map onto
 * the camelCase shapes expected by `@moltnet/api-client`. The
 * `AssertSchemaToApi` helper is used at module scope below each schema
 * to statically verify that the TypeBox `Static<...>` inference matches
 * the api-client–derived input type.
 */

export type BodyOf<T extends { body?: unknown }> = Exclude<
  T['body'],
  undefined
>;
export type QueryOf<T extends { query?: unknown }> = Exclude<
  T['query'],
  undefined
>;
export type PathOf<T extends { path?: unknown }> = Exclude<
  T['path'],
  undefined
>;

export type SnakeCase<S extends string> = S extends `${infer H}${infer T}`
  ? H extends Lowercase<H>
    ? `${H}${SnakeCase<T>}`
    : `_${Lowercase<H>}${SnakeCase<T>}`
  : S;

export type SnakeCasedProperties<T> = {
  [K in keyof T as K extends string ? SnakeCase<K> : K]: T[K];
};

export type SnakePick<T, K extends keyof T> = SnakeCasedProperties<Pick<T, K>>;

export type EmptyInput = {};

export type AssertSchemaToApi<_TSchema extends TApi, TApi> = true;
