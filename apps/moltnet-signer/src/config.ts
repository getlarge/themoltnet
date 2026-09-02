import { parseAllowedOrigins } from '@moltnet/loopback-companion';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

export const SignerEnvironmentSchema = Type.Object(
  {
    MOLTNET_SIGNER_PORT: Type.Number({ minimum: 1, maximum: 65_535 }),
    MOLTNET_SIGNER_ALLOWED_ORIGINS: Type.String({
      default: 'https://console.themolt.net',
      minLength: 1,
    }),
    MOLTNET_API_URL: Type.String({
      default: 'https://api.themolt.net',
      minLength: 1,
    }),
    MOLTNET_SIGNER_DEVICE_TIMEOUT_MS: Type.Number({
      default: 75_000,
      minimum: 1_000,
      maximum: 240_000,
    }),
    MOLTNET_SIGNER_LOG_FILE: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export interface SignerConfig {
  allowedOrigins: string[];
  apiUrl: string;
  approvalBaseUrl: string;
  deviceTimeoutMs: number;
  host: string;
  logFile?: string;
  port: number;
}

export function getSignerConfig(
  env: Record<string, string | undefined> = process.env,
): SignerConfig {
  const raw = Object.fromEntries(
    Object.keys(SignerEnvironmentSchema.properties)
      .filter((key) => env[key] !== undefined && env[key] !== '')
      .map((key) => [key, env[key]]),
  );
  const converted = Value.Convert(SignerEnvironmentSchema, raw);
  const config = Value.Default(SignerEnvironmentSchema, converted);
  if (!Value.Check(SignerEnvironmentSchema, config)) {
    const details = [...Value.Errors(SignerEnvironmentSchema, config)]
      .map((error) => `  - ${error.instancePath}: ${error.message}`)
      .join('\n');
    throw new Error(`Invalid signer config:\n${details}`);
  }

  const host = '127.0.0.1';
  const allowedOrigins = parseAllowedOrigins(
    config.MOLTNET_SIGNER_ALLOWED_ORIGINS,
  );
  if (allowedOrigins.length === 0) {
    throw new Error('Invalid signer config:\n  - allowed origins are required');
  }

  return {
    allowedOrigins,
    apiUrl: config.MOLTNET_API_URL,
    approvalBaseUrl: `http://${host}:${config.MOLTNET_SIGNER_PORT}`,
    deviceTimeoutMs: config.MOLTNET_SIGNER_DEVICE_TIMEOUT_MS,
    host,
    logFile: config.MOLTNET_SIGNER_LOG_FILE,
    port: config.MOLTNET_SIGNER_PORT,
  };
}
