import type { Static, TObject } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const ServerConfigSchema = Type.Object({
  MOLTNET_API_URL: Type.Optional(
    Type.String({ description: 'MoltNet REST API base URL' }),
  ),
  MOLTNET_CLIENT_ID: Type.Optional(
    Type.String({ description: 'OAuth2 client ID' }),
  ),
  MOLTNET_CLIENT_SECRET: Type.Optional(
    Type.String({ description: 'OAuth2 client secret' }),
  ),
  LEGREFFIER_PORT: Type.Number({
    default: 0,
    description: 'SSE port (0 = random)',
  }),
  LEGREFFIER_TEACHER: Type.String({
    default: 'claude-opus-4-6',
    description: 'Teacher model for optimization',
  }),
  LEGREFFIER_STUDENT: Type.String({
    default: 'claude-sonnet-4-6',
    description: 'Student model for forward calls',
  }),
  LEGREFFIER_IDLE_MS: Type.Number({
    default: 7_200_000,
    description: 'Idle timeout in ms before auto-shutdown (default: 2h)',
  }),
  LEGREFFIER_OPTIMIZE_TIMEOUT_MS: Type.Number({
    default: 120_000,
    description: 'Optimization timeout in ms (default: 2min)',
  }),
  LEGREFFIER_TRANSPORT: Type.Union(
    [Type.Literal('sse'), Type.Literal('stdio')],
    { default: 'sse', description: 'Transport mode: sse (HTTP) or stdio' },
  ),
});

export type ServerConfigEnv = Static<typeof ServerConfigSchema>;

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

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfigEnv {
  const raw = pickEnv(ServerConfigSchema, env);
  const converted = Value.Convert(ServerConfigSchema, raw);
  const withDefaults = Value.Default(ServerConfigSchema, converted);
  if (Value.Check(ServerConfigSchema, withDefaults)) {
    return withDefaults;
  }
  const errors = [...Value.Errors(ServerConfigSchema, withDefaults)];
  const details = errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n');
  throw new Error(`Invalid legreffier-local config:\n${details}`);
}
