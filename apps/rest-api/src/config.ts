/**
 * @moltnet/rest-api — Config Module
 *
 * Validates environment variables at startup using TypeBox.
 * Separate schemas per concern so secrets don't leak across the app.
 *
 * This is the ONLY file allowed to read process.env directly.
 */

import type { Static, TObject } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

// ============================================================================
// Schemas
// ============================================================================

export const ServerConfigSchema = Type.Object({
  PORT: Type.Number({ default: 8000 }),
  NODE_ENV: Type.Union(
    [
      Type.Literal('development'),
      Type.Literal('production'),
      Type.Literal('test'),
    ],
    { default: 'development' },
  ),
});

export const DatabaseConfigSchema = Type.Object({
  DATABASE_URL: Type.Optional(Type.String({ minLength: 1 })),
  DBOS_SYSTEM_DATABASE_URL: Type.String({ minLength: 1 }),
});

export const WebhookConfigSchema = Type.Object({
  ORY_ACTION_API_KEY: Type.String({ minLength: 1 }),
});

export const RecoveryConfigSchema = Type.Object({
  RECOVERY_CHALLENGE_SECRET: Type.String({ minLength: 16 }),
});

export const OryConfigSchema = Type.Object({
  ORY_PROJECT_URL: Type.Optional(Type.String({ minLength: 1 })),
  ORY_API_KEY: Type.Optional(Type.String({ minLength: 1 })),
  ORY_KRATOS_PUBLIC_URL: Type.Optional(Type.String({ minLength: 1 })),
  ORY_KRATOS_ADMIN_URL: Type.Optional(Type.String({ minLength: 1 })),
  ORY_HYDRA_PUBLIC_URL: Type.Optional(Type.String({ minLength: 1 })),
  ORY_HYDRA_ADMIN_URL: Type.Optional(Type.String({ minLength: 1 })),
  ORY_KETO_PUBLIC_URL: Type.Optional(Type.String({ minLength: 1 })),
  ORY_KETO_ADMIN_URL: Type.Optional(Type.String({ minLength: 1 })),
});

export const ObservabilityConfigSchema = Type.Object({
  AXIOM_API_TOKEN: Type.Optional(Type.String({ minLength: 1 })),
  AXIOM_LOGS_DATASET: Type.Optional(Type.String({ minLength: 1 })),
  AXIOM_TRACES_DATASET: Type.Optional(Type.String({ minLength: 1 })),
  AXIOM_METRICS_DATASET: Type.Optional(Type.String({ minLength: 1 })),
});

export const SecurityConfigSchema = Type.Object({
  // CORS origins (comma-separated)
  CORS_ORIGINS: Type.String({
    default:
      'https://themolt.net,https://api.themolt.net,http://localhost:3000,http://localhost:8000',
  }),
  // Rate limiting (requests per minute)
  RATE_LIMIT_GLOBAL_AUTH: Type.Number({ default: 100 }),
  RATE_LIMIT_GLOBAL_ANON: Type.Number({ default: 30 }),
  RATE_LIMIT_EMBEDDING: Type.Number({ default: 20 }),
  RATE_LIMIT_VOUCH: Type.Number({ default: 10 }),
  RATE_LIMIT_SIGNING: Type.Number({ default: 5 }),
  RATE_LIMIT_RECOVERY: Type.Number({ default: 5 }),
  RATE_LIMIT_PUBLIC_VERIFY: Type.Number({ default: 10 }),
  RATE_LIMIT_PUBLIC_SEARCH: Type.Number({ default: 15 }),
});

// ============================================================================
// Types
// ============================================================================

export type ServerConfig = Static<typeof ServerConfigSchema>;
export type DatabaseConfig = Static<typeof DatabaseConfigSchema>;
export type WebhookConfig = Static<typeof WebhookConfigSchema>;
export type OryConfig = Static<typeof OryConfigSchema>;
export type ObservabilityEnvConfig = Static<typeof ObservabilityConfigSchema>;
export type RecoveryConfig = Static<typeof RecoveryConfigSchema>;
export type SecurityConfig = Static<typeof SecurityConfigSchema>;

export interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  webhook: WebhookConfig;
  ory: OryConfig;
  observability: ObservabilityEnvConfig;
  recovery: RecoveryConfig;
  security: SecurityConfig;
}

export interface ResolvedOryUrls {
  kratosPublicUrl: string;
  kratosAdminUrl: string;
  hydraPublicUrl: string;
  hydraAdminUrl: string;
  ketoPublicUrl: string;
  ketoAdminUrl: string;
  apiKey?: string;
}

// ============================================================================
// Helpers
// ============================================================================

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

// ============================================================================
// Per-slice loaders
// ============================================================================

export function loadServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  return validateSchema(
    'Server',
    ServerConfigSchema,
    pickEnv(ServerConfigSchema, env),
  );
}

export function loadDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  return validateSchema(
    'Database',
    DatabaseConfigSchema,
    pickEnv(DatabaseConfigSchema, env),
  );
}

export function loadWebhookConfig(
  env: Record<string, string | undefined> = process.env,
): WebhookConfig {
  return validateSchema(
    'Webhook',
    WebhookConfigSchema,
    pickEnv(WebhookConfigSchema, env),
  );
}

export function loadOryConfig(
  env: Record<string, string | undefined> = process.env,
): OryConfig {
  return validateSchema('Ory', OryConfigSchema, pickEnv(OryConfigSchema, env));
}

export function loadObservabilityConfig(
  env: Record<string, string | undefined> = process.env,
): ObservabilityEnvConfig {
  return validateSchema(
    'Observability',
    ObservabilityConfigSchema,
    pickEnv(ObservabilityConfigSchema, env),
  );
}

export function loadRecoveryConfig(
  env: Record<string, string | undefined> = process.env,
): RecoveryConfig {
  return validateSchema(
    'Recovery',
    RecoveryConfigSchema,
    pickEnv(RecoveryConfigSchema, env),
  );
}

export function loadSecurityConfig(
  env: Record<string, string | undefined> = process.env,
): SecurityConfig {
  return validateSchema(
    'Security',
    SecurityConfigSchema,
    pickEnv(SecurityConfigSchema, env),
  );
}

// ============================================================================
// Combined loader
// ============================================================================

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  return {
    server: loadServerConfig(env),
    database: loadDatabaseConfig(env),
    webhook: loadWebhookConfig(env),
    ory: loadOryConfig(env),
    observability: loadObservabilityConfig(env),
    recovery: loadRecoveryConfig(env),
    security: loadSecurityConfig(env),
  };
}

// ============================================================================
// Required secrets introspection
// ============================================================================

const allSchemas: TObject[] = [
  ServerConfigSchema,
  DatabaseConfigSchema,
  WebhookConfigSchema,
  RecoveryConfigSchema,
  OryConfigSchema,
  ObservabilityConfigSchema,
  SecurityConfigSchema,
];

/**
 * Returns env var names that are required at runtime — i.e. listed in
 * `required` by TypeBox (not Optional) AND have no `default` value.
 * Used by the deploy preflight check to verify Fly.io secrets.
 */
export function getRequiredSecrets(): string[] {
  const result: string[] = [];
  for (const schema of allSchemas) {
    const required = new Set<string>(schema.required ?? []);
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (required.has(key) && !('default' in prop)) {
        result.push(key);
      }
    }
  }
  return result;
}

// ============================================================================
// Ory URL resolution
// ============================================================================

export function resolveOryUrls(config: OryConfig): ResolvedOryUrls {
  const fallback = config.ORY_PROJECT_URL;

  function resolve(field: string | undefined, label: string): string {
    const url = field ?? fallback;
    if (!url) {
      throw new Error(
        `Cannot resolve ${label}: neither the individual URL nor ORY_PROJECT_URL is set`,
      );
    }
    return url;
  }

  return {
    kratosPublicUrl: resolve(config.ORY_KRATOS_PUBLIC_URL, 'Kratos public URL'),
    kratosAdminUrl: resolve(config.ORY_KRATOS_ADMIN_URL, 'Kratos admin URL'),
    hydraPublicUrl: resolve(config.ORY_HYDRA_PUBLIC_URL, 'Hydra public URL'),
    hydraAdminUrl: resolve(config.ORY_HYDRA_ADMIN_URL, 'Hydra admin URL'),
    ketoPublicUrl: resolve(config.ORY_KETO_PUBLIC_URL, 'Keto public URL'),
    ketoAdminUrl: resolve(config.ORY_KETO_ADMIN_URL, 'Keto admin URL'),
    apiKey: config.ORY_API_KEY,
  };
}
