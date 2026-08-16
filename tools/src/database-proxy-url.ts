export function databaseUrlForProxy(
  databaseUrl: string,
  portValue: string | undefined,
): string {
  if (portValue === undefined) return databaseUrl;
  if (!/^\d+$/.test(portValue)) {
    throw new Error('--database-proxy-port must be an integer');
  }

  const port = Number(portValue);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('--database-proxy-port must be between 1 and 65535');
  }

  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }

  url.hostname = '127.0.0.1';
  url.port = String(port);
  url.searchParams.set('sslmode', 'disable');
  return url.toString();
}

export function argumentValue(
  argv: readonly string[],
  name: string,
): string | undefined {
  const indexes = argv.flatMap((value, index) =>
    value === name ? [index] : [],
  );
  if (indexes.length > 1) throw new Error(`${name} may only be specified once`);
  if (indexes.length === 0) return undefined;

  const value = argv[indexes[0] + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
