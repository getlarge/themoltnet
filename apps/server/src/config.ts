import type { Static, TObject } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const ServerConfigSchema = Type.Object({
  PORT: Type.Number({ default: 8080 }),
  NODE_ENV: Type.Union(
    [
      Type.Literal('development'),
      Type.Literal('production'),
      Type.Literal('test'),
    ],
    { default: 'development' },
  ),
  STATIC_DIR: Type.Optional(Type.String({ minLength: 1 })),
});

export type ServerConfig = Static<typeof ServerConfigSchema>;

function pickEnv(
  schema: TObject,
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(schema.properties)) {
    if (key in env && env[key] !== undefined && env[key] !== '') {
      raw[key] = env[key];
    }
  }
  return raw;
}

export function loadServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  const raw = pickEnv(ServerConfigSchema, env);
  const converted = Value.Convert(ServerConfigSchema, raw);
  const withDefaults = Value.Default(ServerConfigSchema, converted);
  if (Value.Check(ServerConfigSchema, withDefaults)) {
    return withDefaults;
  }
  const errors = [...Value.Errors(ServerConfigSchema, withDefaults)];
  const details = errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n');
  throw new Error(`Invalid server config:\n${details}`);
}
