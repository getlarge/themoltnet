import type { Static, TObject } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const ContextEvalsConfigSchema = Type.Object({
  MOLTNET_CREDENTIALS_PATH: Type.Optional(Type.String({ minLength: 1 })),
  MOLTNET_DIARY_ID: Type.Optional(Type.String({ minLength: 1 })),
  OPENAI_API_KEY: Type.Optional(Type.String({ minLength: 1 })),
  ANTHROPIC_API_KEY: Type.Optional(Type.String({ minLength: 1 })),
  ANTHROPIC_AUTH_TOKEN: Type.Optional(Type.String({ minLength: 1 })),
  GOOGLE_API_KEY: Type.Optional(Type.String({ minLength: 1 })),
  GPACK_AGENT_MODEL: Type.Optional(Type.String({ minLength: 1 })),
  CLAUDE_CODE_EXECUTABLE: Type.Optional(Type.String({ minLength: 1 })),
});

export type ContextEvalsConfig = Static<typeof ContextEvalsConfigSchema>;

function pickEnv(
  schema: TObject,
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(schema.properties)) {
    const value = env[key];
    if (value !== undefined && value !== '') {
      raw[key] = value;
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

export function loadContextEvalsConfig(
  env: Record<string, string | undefined> = process.env,
): ContextEvalsConfig {
  return validateSchema(
    'ContextEvals',
    ContextEvalsConfigSchema,
    pickEnv(ContextEvalsConfigSchema, env),
  );
}

/**
 * Build a clean env for the Claude Code subprocess spawned by the SDK.
 *
 * Strips vars that leak from the interactive session or .env.local and
 * break the eval subprocess:
 * - CLAUDECODE — nested-session guard (immediate exit)
 * - CLAUDE_CODE_OAUTH_TOKEN — causes 401 "OAuth authentication is
 *   currently not supported" when used against the API
 */
export function getRuntimeEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}
