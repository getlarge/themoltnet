import { isIP } from 'node:net';

export const MAX_DISCOVERED_MODELS = 500;

export class AgentServerModelDiscoveryError extends Error {
  override name = 'AgentServerModelDiscoveryError';

  constructor(
    readonly code:
      | 'invalid_provider'
      | 'discovery_failed'
      | 'discovery_unauthorized'
      | 'discovery_unavailable'
      | 'discovery_invalid_response',
    message: string,
    readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type DiscoveryFailure =
  | { kind: 'http'; status: number }
  | { kind: 'network'; errorType: string }
  | { kind: 'invalid_response' };

export class ModelDiscoveryCollector {
  private readonly models = new Set<string>();

  addOpenAiResponse(value: unknown): void {
    if (!isRecord(value) || !Array.isArray(value['data'])) return;
    for (const candidate of value['data']) {
      if (!isRecord(candidate)) continue;
      const id = candidate['id'];
      if (typeof id === 'string' && id.length > 0) this.models.add(id);
    }
  }

  addOllamaResponse(value: unknown): void {
    if (!isRecord(value) || !Array.isArray(value['models'])) return;
    for (const candidate of value['models']) {
      if (!isRecord(candidate)) continue;
      const name = candidate['name'];
      if (typeof name === 'string' && name.length > 0) this.models.add(name);
    }
  }

  get size(): number {
    return this.models.size;
  }

  result(
    providerId: string,
    failures: readonly DiscoveryFailure[],
  ): {
    models: string[];
    discoveredCount: number;
  } {
    if (this.models.size === 0) throw discoveryFailure(providerId, failures);
    return {
      models: [...this.models].sort().slice(0, MAX_DISCOVERED_MODELS),
      discoveredCount: this.models.size,
    };
  }
}

export function parseProviderBaseUrl(value: string, providerId: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new AgentServerModelDiscoveryError(
      'invalid_provider',
      `provider "${providerId}" has an invalid base URL`,
      400,
      { cause },
    );
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new AgentServerModelDiscoveryError(
      'invalid_provider',
      `provider "${providerId}" base URL must be HTTP(S) without credentials, query, or fragment`,
      400,
    );
  }
  if (isNonLoopbackPrivateAddress(parsed.hostname)) {
    throw new ServeModelDiscoveryError(
      'invalid_provider',
      `provider "${providerId}" base URL must not target a private network address`,
      400,
    );
  }
  return parsed;
}

function isNonLoopbackPrivateAddress(hostname: string): boolean {
  if (isIP(hostname) !== 4) return false;
  const [first, second] = hostname.split('.').map(Number);
  if (first === 127) return false;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function discoveryFailure(
  providerId: string,
  failures: readonly DiscoveryFailure[],
): AgentServerModelDiscoveryError {
  if (
    failures.some(
      (failure) =>
        failure.kind === 'http' &&
        (failure.status === 401 || failure.status === 403),
    )
  ) {
    return new AgentServerModelDiscoveryError(
      'discovery_unauthorized',
      `provider "${providerId}" rejected model discovery; check its API key`,
      502,
    );
  }
  if (failures.some((failure) => failure.kind === 'network')) {
    return new AgentServerModelDiscoveryError(
      'discovery_unavailable',
      `provider "${providerId}" could not be reached for model discovery`,
      502,
    );
  }
  if (failures.some((failure) => failure.kind === 'invalid_response')) {
    return new AgentServerModelDiscoveryError(
      'discovery_invalid_response',
      `provider "${providerId}" returned an invalid model response`,
      502,
    );
  }
  return new AgentServerModelDiscoveryError(
    'discovery_failed',
    `no models discovered for provider "${providerId}"`,
    502,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
