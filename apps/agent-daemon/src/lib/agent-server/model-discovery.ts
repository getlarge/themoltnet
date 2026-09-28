import { isIP } from 'node:net';

import type { ProviderModelEntry, ProviderModelModality } from './store.js';

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

/** Ollama exposes vision and thinking independently for each model. */
const OLLAMA_VISION_CAPABILITY = 'vision';
const OLLAMA_THINKING_CAPABILITY = 'thinking';

export const OLLAMA_THINKING_LEVEL_MAP: Record<string, string> = {
  off: 'none',
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'max',
};

const LEVELS = ['low', 'medium', 'high', 'max'] as const;

function thinkingMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value) || !Array.isArray(value['values'])) return undefined;
  const values = value['values'];
  const names = LEVELS.filter((level) => values.includes(level));
  const falseSupported = values.includes(false) || values.includes('none');
  if (names.length === 0) {
    const named = values.find(
      (item): item is string => typeof item === 'string' && item !== 'none',
    );
    if (named) {
      return Object.fromEntries(
        ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((level) => [
          level,
          level === 'off' && falseSupported ? 'none' : named,
        ]),
      );
    }
    return values.includes(true)
      ? {
          ...OLLAMA_THINKING_LEVEL_MAP,
          ...(!falseSupported ? { off: 'low' } : {}),
        }
      : undefined;
  }
  const nearest = (level: number) =>
    [...names].reverse().find((name) => LEVELS.indexOf(name) <= level) ??
    names[0];
  return {
    off: falseSupported ? 'none' : names[0],
    minimal: names[0],
    low: nearest(0),
    medium: nearest(1),
    high: nearest(2),
    xhigh: names.at(-1) ?? names[0],
  };
}

export function readOllamaCapabilities(
  value: unknown,
): Omit<ProviderModelEntry, 'id'> | undefined {
  if (!isRecord(value)) return undefined;
  const capabilities = Array.isArray(value['capabilities'])
    ? value['capabilities']
    : undefined;
  const declaredThinking =
    isRecord(value['thinking']) && Array.isArray(value['thinking']['values']);
  const map = thinkingMap(value['thinking']);
  if (!capabilities && !declaredThinking) return undefined;
  const input = capabilities
    ? {
        input: capabilities.includes(OLLAMA_VISION_CAPABILITY)
          ? (['text', 'image'] as ProviderModelModality[])
          : ([] as ProviderModelModality[]),
      }
    : {};
  return map ||
    (!declaredThinking && capabilities?.includes(OLLAMA_THINKING_CAPABILITY))
    ? {
        ...input,
        reasoning: true,
        ...(map ? { thinkingLevelMap: map } : {}),
      }
    : { ...input, reasoning: false };
}

export class ModelDiscoveryCollector {
  /**
   * Model id → detected capabilities. `undefined` means the id is known but
   * its capabilities are not, so it is still a probe candidate.
   */
  private readonly models = new Map<
    string,
    Omit<ProviderModelEntry, 'id'> | undefined
  >();

  private record(
    id: string,
    metadata: Omit<ProviderModelEntry, 'id'> | undefined,
  ): void {
    // Never let a later id-only sighting erase modalities an earlier response
    // supplied: /v1/models and /api/tags overlap, and only one carries them.
    if (metadata === undefined && this.models.has(id)) return;
    this.models.set(id, metadata);
  }

  addOpenAiResponse(value: unknown): void {
    if (!isRecord(value) || !Array.isArray(value['data'])) return;
    for (const candidate of value['data']) {
      if (!isRecord(candidate)) continue;
      const id = candidate['id'];
      if (typeof id === 'string' && id.length > 0) this.record(id, undefined);
    }
  }

  addOllamaResponse(value: unknown): void {
    if (!isRecord(value) || !Array.isArray(value['models'])) return;
    for (const candidate of value['models']) {
      if (!isRecord(candidate)) continue;
      const name = candidate['name'];
      if (typeof name === 'string' && name.length > 0) {
        this.record(name, readOllamaCapabilities(candidate));
      }
    }
  }

  setCapabilities(id: string, metadata: Omit<ProviderModelEntry, 'id'>): void {
    if (this.models.has(id))
      this.models.set(id, { ...this.models.get(id), ...metadata });
  }

  get size(): number {
    return this.models.size;
  }

  result(
    providerId: string,
    failures: readonly DiscoveryFailure[],
  ): {
    models: ProviderModelEntry[];
    /** Ids still lacking capability information, in returned order. */
    unresolved: string[];
    discoveredCount: number;
  } {
    if (this.models.size === 0) throw discoveryFailure(providerId, failures);
    const ids = [...this.models.keys()].sort().slice(0, MAX_DISCOVERED_MODELS);
    return {
      models: ids.map((id) => {
        const metadata = this.models.get(id);
        return {
          id,
          ...(metadata?.input?.length ? { input: [...metadata.input] } : {}),
          ...(metadata?.reasoning !== undefined
            ? { reasoning: metadata.reasoning }
            : {}),
          ...(metadata?.thinkingLevelMap
            ? { thinkingLevelMap: { ...metadata.thinkingLevelMap } }
            : {}),
        };
      }),
      unresolved: ids.filter((id) => this.models.get(id) === undefined),
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
    throw new AgentServerModelDiscoveryError(
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
