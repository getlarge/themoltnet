import type { Static, TObject } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const McpServerConfigSchema = Type.Object({
  PORT: Type.Number({ default: 8001 }),
  NODE_ENV: Type.Union(
    [
      Type.Literal('development'),
      Type.Literal('production'),
      Type.Literal('test'),
    ],
    { default: 'development' },
  ),
  REST_API_URL: Type.String({ minLength: 1 }),
  AUTH_ENABLED: Type.Optional(
    Type.Boolean({
      default: false,
      description: 'Enable OAuth2 authorization',
    }),
  ),
  ORY_PROJECT_URL: Type.Optional(
    Type.String({ minLength: 1, description: 'Ory Hydra public URL' }),
  ),
  ORY_PROJECT_API_KEY: Type.Optional(
    Type.String({
      minLength: 1,
      description: 'Ory API key for token introspection',
    }),
  ),
  MCP_RESOURCE_URI: Type.Optional(
    Type.String({
      minLength: 1,
      description: "This server's public URL (for OAuth2 resource metadata)",
    }),
  ),
});

export type McpServerConfig = Static<typeof McpServerConfigSchema>;

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

function validateSchema<T extends TObject>(
  name: string,
  schema: T,
  raw: Record<string, unknown>,
): Static<T> {
  const converted = Value.Convert(schema, raw);
  const withDefaults = Value.Default(schema, converted);
  if (Value.Check(schema, withDefaults)) {
    return withDefaults;
  }
  const errors = [...Value.Errors(schema, withDefaults)];
  const details = errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n');
  throw new Error(`Invalid ${name} config:\n${details}`);
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): McpServerConfig {
  return validateSchema(
    'McpServer',
    McpServerConfigSchema,
    pickEnv(McpServerConfigSchema, env),
  );
}
