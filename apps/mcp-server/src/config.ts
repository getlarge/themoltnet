import type { Static, TObject } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const McpServerConfigSchema = Type.Object({
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
    Type.String({
      minLength: 1,
      description:
        'Ory Network project URL (fallback when individual URLs are not set)',
    }),
  ),
  ORY_HYDRA_PUBLIC_URL: Type.Optional(
    Type.String({
      minLength: 1,
      description: 'Ory Hydra public URL (JWKS, DCR, authorization server)',
    }),
  ),
  ORY_HYDRA_ADMIN_URL: Type.Optional(
    Type.String({
      minLength: 1,
      description: 'Ory Hydra admin URL (token introspection)',
    }),
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
  CLIENT_CREDENTIALS_PROXY: Type.Optional(
    Type.Boolean({
      default: false,
      description:
        'Enable client_credentials proxy for headless agent auth via X-Client-Id/X-Client-Secret headers',
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

/**
 * Returns env var names that are required at runtime — i.e. listed in
 * `required` by TypeBox (not Optional) AND have no `default` value.
 * Used by the deploy preflight check to verify Fly.io secrets.
 */
export function getRequiredSecrets(): string[] {
  const required = new Set<string>(McpServerConfigSchema.required ?? []);
  const result: string[] = [];
  for (const [key, prop] of Object.entries(McpServerConfigSchema.properties)) {
    if (required.has(key) && !('default' in prop)) {
      result.push(key);
    }
  }
  return result;
}

export interface ResolvedHydraUrls {
  publicUrl: string;
  adminUrl: string;
  apiKey?: string;
}

export function resolveHydraUrls(
  config: McpServerConfig,
): ResolvedHydraUrls | null {
  const fallback = config.ORY_PROJECT_URL;
  const publicUrl = config.ORY_HYDRA_PUBLIC_URL ?? fallback;
  const adminUrl = config.ORY_HYDRA_ADMIN_URL ?? fallback;

  if (!publicUrl) {
    return null;
  }

  return {
    publicUrl,
    adminUrl: adminUrl ?? publicUrl,
    apiKey: config.ORY_PROJECT_API_KEY,
  };
}
