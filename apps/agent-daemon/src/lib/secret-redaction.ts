const REDACTED = '[REDACTED]';
const MIN_SECRET_LENGTH = 8;

/**
 * Redact required runtime-profile environment values before task output leaves
 * the daemon. This is defense in depth for shell-capable profiles: a model may
 * read a forwarded provider key, but it must not be able to publish that exact
 * value through a task result.
 */
export function redactRequiredEnvValues<T>(
  value: T,
  requiredEnv: readonly string[],
  env: NodeJS.ProcessEnv,
): T {
  const secrets = [
    ...new Set(
      requiredEnv
        .map((name) => env[name])
        .filter(
          (secret): secret is string =>
            typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH,
        ),
    ),
  ];
  if (secrets.length === 0) return value;

  const redact = (candidate: unknown): unknown => {
    if (typeof candidate === 'string') {
      return secrets.reduce(
        (text, secret) => text.replaceAll(secret, REDACTED),
        candidate,
      );
    }
    if (Array.isArray(candidate)) return candidate.map(redact);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate).map(([key, nested]) => [key, redact(nested)]),
      );
    }
    return candidate;
  };

  return redact(value) as T;
}
