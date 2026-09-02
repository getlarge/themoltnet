/**
 * Typed client for the local `moltnet-agent serve` supervisor (#2061/#2062).
 *
 * Loopback-only, `credentials: 'omit'` — the browser session never reaches
 * the companion (same rule as the signer client). Authenticated routes carry
 * the origin-bound pairing token in `x-moltnet-serve-token`; the header name
 * mirrors `SERVE_TOKEN_HEADER` in
 * `apps/agent-daemon/src/lib/serve/server.ts`.
 */

import { loopbackHttpUrl } from '../loopback-url.js';
import {
  PairingClaimedSchema,
  PairingStartedSchema,
  parseServeResponse,
  ProblemSchema,
  type ServeAgentView,
  ServeAgentViewSchema,
  type ServeProviderView,
  ServeProviderViewSchema,
  type ServeRunView,
  ServeRunViewSchema,
  type ServeStatus,
  ServeStatusSchema,
  type ServeSubscriptionLogin,
  ServeSubscriptionLoginSchema,
  type ServeSubscriptionView,
} from './serve-protocol.js';

export type {
  ServeAgentView,
  ServeProviderView,
  ServeRunView,
  ServeStatus,
  ServeSubscriptionLogin,
  ServeSubscriptionView,
} from './serve-protocol.js';

export const SERVE_TOKEN_HEADER = 'x-moltnet-serve-token';
const READ_TIMEOUT_MS = 5_000;
const MUTATION_TIMEOUT_MS = 60_000;
const MAX_SSE_EVENT_CHARS = 256 * 1024;

export type CreateAgentBody =
  | {
      kind: 'managed';
      name: string;
      enrollmentToken?: string;
      apiUrl?: never;
      configDir?: never;
    }
  | {
      kind: 'external';
      name: string;
      configDir: string;
      apiUrl?: string;
      enrollmentToken?: never;
    };

export interface PutProviderBody {
  api: string;
  baseUrl: string;
  models: string[];
  apiKey?: string;
}

export interface StartRunBody {
  agent: string;
  teamId: string;
  profiles: string[];
  taskTypes: string[];
  mode: 'poll' | 'drain';
}

export type ServeHealthResult =
  | { status: 'ok' }
  | { status: 'unavailable'; reason: 'network' | 'timeout' }
  | { status: 'incompatible'; httpStatus: number };

export class ServeClientError extends Error {
  override name = 'ServeClientError';
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ServeClient {
  baseUrl: string;
  health(): Promise<ServeHealthResult>;
  startPairing(): Promise<{ pairingId: string; approvalPath: string }>;
  claimPairing(pairingId: string): Promise<{ token: string }>;
  approvalUrl(approvalPath: string): string;
  status(): Promise<ServeStatus>;
  createAgent(body: CreateAgentBody): Promise<ServeAgentView>;
  putProvider(id: string, body: PutProviderBody): Promise<ServeProviderView>;
  startRun(body: StartRunBody): Promise<ServeRunView>;
  stopRun(runId: string): Promise<void>;
  startSubscriptionLogin(providerId: string): Promise<ServeSubscriptionLogin>;
  subscriptionLoginStatus(providerId: string): Promise<ServeSubscriptionLogin>;
  cancelSubscriptionLogin(providerId: string): Promise<void>;
  discoverModels(providerId: string): Promise<string[]>;
  streamLogs(
    runId: string,
    onLine: (line: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

export function createServeClient(options: {
  baseUrl: string;
  getToken: () => string | null;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}): ServeClient {
  const baseUrl = loopbackHttpUrl(options.baseUrl, 'Serve companion');
  const base = baseUrl.href.replace(/\/$/, '');
  const fetchImpl = options.fetch ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? READ_TIMEOUT_MS;

  async function request<T>(
    method: string,
    path: string,
    parse: ((value: unknown) => T) | null,
    body?: unknown,
    requestOptions: {
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = options.getToken();
    if (token) headers[SERVE_TOKEN_HEADER] = token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(
          requestOptions.timeoutMs ?? requestTimeoutMs,
        ),
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === 'TimeoutError';
      throw new ServeClientError(
        timedOut ? 'request_timeout' : 'serve_unavailable',
        timedOut
          ? 'The local supervisor request timed out.'
          : 'The local supervisor is unavailable.',
        0,
      );
    }
    if (!response.ok) {
      throw await responseError(response);
    }
    if (!parse) return undefined as T;
    return parse(await response.json());
  }

  return {
    baseUrl: base,
    async health(): Promise<ServeHealthResult> {
      try {
        const response = await fetchImpl(`${base}/health`, {
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(2_000),
        });
        return response.ok
          ? { status: 'ok' }
          : { status: 'incompatible', httpStatus: response.status };
      } catch (error) {
        return {
          status: 'unavailable',
          reason:
            error instanceof DOMException && error.name === 'TimeoutError'
              ? 'timeout'
              : 'network',
        };
      }
    },
    startPairing() {
      return request('POST', '/v1/pairings', (value) =>
        parseServeResponse(PairingStartedSchema, value, 'pairing'),
      );
    },
    claimPairing(pairingId: string) {
      return request(
        'POST',
        `/v1/pairings/${encodeURIComponent(pairingId)}/claim`,
        (value) => parseServeResponse(PairingClaimedSchema, value, 'claim'),
      );
    },
    approvalUrl(approvalPath: string): string {
      return `${base}${approvalPath}`;
    },
    status() {
      return request('GET', '/v1/status', (value) =>
        parseServeResponse(ServeStatusSchema, value, 'status'),
      );
    },
    createAgent(body: CreateAgentBody) {
      return request(
        'POST',
        '/v1/agents',
        (value) => parseServeResponse(ServeAgentViewSchema, value, 'agent'),
        body,
        { timeoutMs: MUTATION_TIMEOUT_MS },
      );
    },
    async putProvider(id: string, body: PutProviderBody) {
      const providerId = assertProviderId(id);
      return request(
        'PUT',
        `/v1/providers/${providerId}`,
        (value) =>
          parseServeResponse(ServeProviderViewSchema, value, 'provider'),
        {
          ...body,
          baseUrl: providerBaseUrl(body.baseUrl),
          envName: providerEnvName(providerId),
        },
        { timeoutMs: MUTATION_TIMEOUT_MS },
      );
    },
    startRun(body: StartRunBody) {
      return request(
        'POST',
        '/v1/runs',
        (value) => parseServeResponse(ServeRunViewSchema, value, 'run'),
        body,
        { timeoutMs: MUTATION_TIMEOUT_MS },
      );
    },
    async stopRun(runId: string): Promise<void> {
      await request('DELETE', `/v1/runs/${encodeURIComponent(runId)}`, null);
    },
    startSubscriptionLogin(providerId: string) {
      const id = assertProviderId(providerId);
      return request(
        'POST',
        `/v1/subscriptions/${id}/login`,
        (value) =>
          parseServeResponse(
            ServeSubscriptionLoginSchema,
            value,
            'subscription login',
          ),
        undefined,
        { timeoutMs: MUTATION_TIMEOUT_MS },
      );
    },
    subscriptionLoginStatus(providerId: string) {
      const id = assertProviderId(providerId);
      return request('GET', `/v1/subscriptions/${id}/login`, (value) =>
        parseServeResponse(
          ServeSubscriptionLoginSchema,
          value,
          'subscription login',
        ),
      );
    },
    async cancelSubscriptionLogin(providerId: string): Promise<void> {
      await request('DELETE', `/v1/subscriptions/${providerId}/login`);
    },
    async discoverModels(providerId: string): Promise<string[]> {
      const result = await request<{ models: string[] }>(
        'POST',
        `/v1/providers/${encodeURIComponent(providerId)}/discover-models`,
      );
      return result.models;
    },
    // SSE over fetch: EventSource cannot send the pairing-token header, so
    // read the stream manually and surface `data:` payload lines.
    async streamLogs(
      runId: string,
      onLine: (line: string) => void,
      signal: AbortSignal,
    ): Promise<void> {
      const headers: Record<string, string> = {};
      const token = options.getToken();
      if (token) headers[SERVE_TOKEN_HEADER] = token;
      const response = await fetchImpl(
        `${base}/v1/runs/${encodeURIComponent(runId)}/logs`,
        {
          credentials: 'omit',
          redirect: 'error',
          headers,
          signal,
        },
      );
      if (!response.ok) throw await responseError(response);
      const contentType = response.headers.get('content-type')?.toLowerCase();
      if (!contentType?.startsWith('text/event-stream')) {
        throw new ServeClientError(
          'logs_invalid_content_type',
          'The local supervisor returned an invalid log stream.',
          response.status,
        );
      }
      if (!response.body) {
        throw new ServeClientError(
          'logs_unavailable',
          'The local supervisor returned an empty log stream.',
          response.status,
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            emitSseLines(buffer.split(/\r?\n/u), onLine);
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\r?\n/u);
          buffer = parts.pop() ?? '';
          if (ssePayloadLength(buffer) > MAX_SSE_EVENT_CHARS) {
            throw new ServeClientError(
              'logs_event_too_large',
              'The local supervisor returned an oversized log event.',
              0,
            );
          }
          emitSseLines(parts, onLine);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
  };
}

async function responseError(response: Response): Promise<ServeClientError> {
  let code = 'request_failed';
  let message = `serve request failed with ${response.status}`;
  try {
    const problem = parseServeResponse(
      ProblemSchema,
      await response.json(),
      'error',
    );
    if (problem.code) code = problem.code;
    if (problem.message) message = problem.message;
  } catch {
    // Keep the stable fallback for non-JSON failures.
  }
  return new ServeClientError(code, message, response.status);
}

function emitSseLines(parts: string[], onLine: (line: string) => void): void {
  for (const part of parts) {
    const payload = part.startsWith('data: ')
      ? part.slice('data: '.length)
      : undefined;
    if ((payload ?? part).length > MAX_SSE_EVENT_CHARS) {
      throw new ServeClientError(
        'logs_event_too_large',
        'The local supervisor returned an oversized log event.',
        0,
      );
    }
    if (payload !== undefined) onLine(payload);
  }
}

export function providerEnvName(providerId: string): string {
  const id = assertProviderId(providerId);
  return `MOLTNET_PROVIDER_${id.replaceAll('-', '_').toUpperCase()}_API_KEY`;
}

function assertProviderId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new ServeClientError(
      'invalid_provider_id',
      'Provider id must use lowercase letters, digits, or hyphens.',
      0,
    );
  }
  return value;
}

function providerBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServeClientError(
      'invalid_provider_url',
      'Provider URL must be a valid HTTP(S) URL.',
      0,
    );
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ServeClientError(
      'invalid_provider_url',
      'Provider URL must be HTTP(S) without credentials, query, or fragment.',
      0,
    );
  }
  return value;
}

function ssePayloadLength(value: string): number {
  return value.startsWith('data: ')
    ? value.length - 'data: '.length
    : value.length;
}
