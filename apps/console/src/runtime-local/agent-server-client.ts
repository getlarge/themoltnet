/**
 * Typed client for the local `moltnet-agent server` supervisor (#2061/#2062).
 *
 * Loopback-only, `credentials: 'omit'` — the browser session never reaches
 * the companion (same rule as the signer client). Authenticated routes carry
 * the origin-bound pairing token in `x-moltnet-agent-server-token`; the header name
 * mirrors `AGENT_SERVER_TOKEN_HEADER` in
 * `apps/agent-daemon/src/lib/agent-server/server.ts`.
 */

import type {
  AgentServerAgent,
  AgentServerProvider,
  AgentServerRun,
  AgentServerStatus,
  AgentServerSubscriptionLogin,
  CreateAgentServerAgentData,
  PutAgentServerProviderData,
  StartAgentServerRunData,
} from '@moltnet/agent-daemon-api-client';

import { loopbackFetch, loopbackUrl } from '../loopback-url.js';
import {
  AgentServerAgentViewSchema,
  AgentServerProviderViewSchema,
  AgentServerRunViewSchema,
  AgentServerStatusSchema,
  AgentServerSubscriptionLoginSchema,
  DiscoverModelsSchema,
  PairingClaimedSchema,
  PairingStartedSchema,
  parseAgentServerResponse,
  ProblemSchema,
} from './agent-server-response-validation.js';

export type {
  AgentServerAgent as AgentServerAgentView,
  AgentServerProvider as AgentServerProviderView,
  AgentServerRun as AgentServerRunView,
  AgentServerStatus,
  AgentServerSubscriptionLogin,
  AgentServerSubscription as AgentServerSubscriptionView,
} from '@moltnet/agent-daemon-api-client';

export const AGENT_SERVER_TOKEN_HEADER = 'x-moltnet-agent-server-token';
const READ_TIMEOUT_MS = 5_000;
const MUTATION_TIMEOUT_MS = 60_000;
const MAX_SSE_EVENT_CHARS = 256 * 1024;

export type CreateAgentBody = NonNullable<CreateAgentServerAgentData['body']>;
export type PutProviderBody = Omit<
  PutAgentServerProviderData['body'],
  'envName'
>;
export type StartRunBody = StartAgentServerRunData['body'];

export type AgentServerHealthResult =
  | { status: 'ok' }
  | { status: 'unavailable'; reason: 'network' | 'timeout' }
  | { status: 'incompatible'; httpStatus: number };

export class AgentServerClientError extends Error {
  override name = 'AgentServerClientError';
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface AgentServerClient {
  baseUrl: string;
  health(): Promise<AgentServerHealthResult>;
  startPairing(): Promise<{ pairingId: string; approvalPath: string }>;
  claimPairing(pairingId: string): Promise<{ token: string }>;
  approvalUrl(approvalPath: string): string;
  status(): Promise<AgentServerStatus>;
  createAgent(body: CreateAgentBody): Promise<AgentServerAgent>;
  putProvider(id: string, body: PutProviderBody): Promise<AgentServerProvider>;
  deleteProvider(id: string): Promise<void>;
  startRun(body: StartRunBody): Promise<AgentServerRun>;
  stopRun(runId: string): Promise<void>;
  startSubscriptionLogin(
    providerId: string,
    signal?: AbortSignal,
  ): Promise<AgentServerSubscriptionLogin>;
  subscriptionLoginStatus(
    providerId: string,
    signal?: AbortSignal,
  ): Promise<AgentServerSubscriptionLogin>;
  cancelSubscriptionLogin(providerId: string): Promise<void>;
  discoverModels(providerId: string): Promise<string[]>;
  streamLogs(
    runId: string,
    onLine: (line: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

export function createAgentServerClient(options: {
  baseUrl: string;
  getToken: () => string | null;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}): AgentServerClient {
  const baseUrl = loopbackUrl(options.baseUrl, 'Agent Server');
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
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = options.getToken();
    if (token) headers[AGENT_SERVER_TOKEN_HEADER] = token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const timeoutSignal = AbortSignal.timeout(
      requestOptions.timeoutMs ?? requestTimeoutMs,
    );
    const signal = requestOptions.signal
      ? forwardAbort(requestOptions.signal, timeoutSignal)
      : timeoutSignal;
    let response: Response;
    try {
      response = await loopbackFetch(fetchImpl, `${base}${path}`, {
        method,
        credentials: 'omit',
        redirect: 'error',
        signal,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === 'TimeoutError';
      throw new AgentServerClientError(
        timedOut ? 'request_timeout' : 'agent_server_unavailable',
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
    async health(): Promise<AgentServerHealthResult> {
      try {
        const response = await loopbackFetch(fetchImpl, `${base}/health`, {
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
        parseAgentServerResponse(PairingStartedSchema, value, 'pairing'),
      );
    },
    claimPairing(pairingId: string) {
      return request(
        'POST',
        `/v1/pairings/${encodeURIComponent(pairingId)}/claim`,
        (value) =>
          parseAgentServerResponse(PairingClaimedSchema, value, 'claim'),
      );
    },
    approvalUrl(approvalPath: string): string {
      return `${base}${approvalPath}`;
    },
    status() {
      return request('GET', '/v1/status', (value) =>
        parseAgentServerResponse(AgentServerStatusSchema, value, 'status'),
      );
    },
    createAgent(body: CreateAgentBody) {
      return request(
        'POST',
        '/v1/agents',
        (value) =>
          parseAgentServerResponse(AgentServerAgentViewSchema, value, 'agent'),
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
          parseAgentServerResponse(
            AgentServerProviderViewSchema,
            value,
            'provider',
          ),
        {
          ...body,
          baseUrl: providerBaseUrl(body.baseUrl),
          envName: providerEnvName(providerId),
        },
        { timeoutMs: MUTATION_TIMEOUT_MS },
      );
    },
    async deleteProvider(id: string): Promise<void> {
      const providerId = assertProviderId(id);
      await request('DELETE', `/v1/providers/${providerId}`, null, undefined, {
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
    },
    startRun(body: StartRunBody) {
      return request(
        'POST',
        '/v1/runs',
        (value) =>
          parseAgentServerResponse(AgentServerRunViewSchema, value, 'run'),
        body,
        { timeoutMs: MUTATION_TIMEOUT_MS },
      );
    },
    async stopRun(runId: string): Promise<void> {
      await request('DELETE', `/v1/runs/${encodeURIComponent(runId)}`, null);
    },
    startSubscriptionLogin(providerId: string, signal?: AbortSignal) {
      const id = assertProviderId(providerId);
      return request(
        'POST',
        `/v1/subscriptions/${id}/login`,
        (value) =>
          parseAgentServerResponse(
            AgentServerSubscriptionLoginSchema,
            value,
            'subscription login',
          ),
        undefined,
        { timeoutMs: MUTATION_TIMEOUT_MS, signal },
      );
    },
    subscriptionLoginStatus(providerId: string, signal?: AbortSignal) {
      const id = assertProviderId(providerId);
      return request(
        'GET',
        `/v1/subscriptions/${id}/login`,
        (value) =>
          parseAgentServerResponse(
            AgentServerSubscriptionLoginSchema,
            value,
            'subscription login',
          ),
        undefined,
        { signal },
      );
    },
    async cancelSubscriptionLogin(providerId: string): Promise<void> {
      const id = assertProviderId(providerId);
      await request(
        'DELETE',
        `/v1/subscriptions/${id}/login`,
        null,
        undefined,
        { timeoutMs: MUTATION_TIMEOUT_MS },
      );
    },
    async discoverModels(providerId: string): Promise<string[]> {
      const id = assertProviderId(providerId);
      const result = await request(
        'POST',
        `/v1/providers/${id}/discover-models`,
        (value) =>
          parseAgentServerResponse(
            DiscoverModelsSchema,
            value,
            'model discovery',
          ),
        undefined,
        { timeoutMs: MUTATION_TIMEOUT_MS },
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
      if (token) headers[AGENT_SERVER_TOKEN_HEADER] = token;
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
        throw new AgentServerClientError(
          'logs_invalid_content_type',
          'The local supervisor returned an invalid log stream.',
          response.status,
        );
      }
      if (!response.body) {
        throw new AgentServerClientError(
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
            throw new AgentServerClientError(
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

function forwardAbort(...sources: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const source of sources) {
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
    const forward = () => controller.abort(source.reason);
    source.addEventListener('abort', forward, { once: true });
    controller.signal.addEventListener(
      'abort',
      () => source.removeEventListener('abort', forward),
      { once: true },
    );
  }
  return controller.signal;
}

async function responseError(
  response: Response,
): Promise<AgentServerClientError> {
  let code = 'request_failed';
  let message = `Agent Server request failed with ${response.status}`;
  try {
    const problem = parseAgentServerResponse(
      ProblemSchema,
      await response.json(),
      'error',
    );
    if (problem.code) code = problem.code;
    if (problem.message) message = problem.message;
  } catch {
    // Keep the stable fallback for non-JSON failures.
  }
  return new AgentServerClientError(code, message, response.status);
}

function emitSseLines(parts: string[], onLine: (line: string) => void): void {
  for (const part of parts) {
    const payload = part.startsWith('data: ')
      ? part.slice('data: '.length)
      : undefined;
    if ((payload ?? part).length > MAX_SSE_EVENT_CHARS) {
      throw new AgentServerClientError(
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
    throw new AgentServerClientError(
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
    throw new AgentServerClientError(
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
    throw new AgentServerClientError(
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
