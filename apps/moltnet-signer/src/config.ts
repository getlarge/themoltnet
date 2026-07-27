export interface SignerConfig {
  allowedOrigins: string[];
  apiUrl: string;
  approvalBaseUrl: string;
  host: string;
  port: number;
}

export function getSignerConfig(
  env: Record<string, string | undefined> = process.env,
): SignerConfig {
  const host = '127.0.0.1';
  const port = integerEnv(env['MOLTNET_SIGNER_PORT']);
  const allowedOrigins = (
    env['MOLTNET_SIGNER_ALLOWED_ORIGINS'] ??
    'https://console.themolt.net,http://localhost:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    allowedOrigins,
    apiUrl: env['MOLTNET_API_URL'] ?? 'https://api.themolt.net',
    approvalBaseUrl: `http://${host}:${port}`,
    host,
    port,
  };
}

function integerEnv(raw: string | undefined): number {
  if (raw === undefined) {
    throw new Error('MOLTNET_SIGNER_PORT is required');
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('MOLTNET_SIGNER_PORT must be a valid TCP port');
  }
  return value;
}
