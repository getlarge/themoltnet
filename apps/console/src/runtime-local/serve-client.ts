/**
 * Typed client for the local `moltnet-agent serve` supervisor (#2061/#2062).
 *
 * Loopback-only, `credentials: 'omit'` — the browser session never reaches
 * the companion (same rule as the signer client). Authenticated routes carry
 * the origin-bound pairing token in `x-moltnet-serve-token`; the header name
 * mirrors `SERVE_TOKEN_HEADER` in
 * `apps/agent-daemon/src/lib/serve/server.ts`.
 */

export const SERVE_TOKEN_HEADER = 'x-moltnet-serve-token';
const READ_TIMEOUT_MS = 5_000;
const MUTATION_TIMEOUT_MS = 60_000;
const MAX_SSE_EVENT_CHARS = 256 * 1024;

export interface ServeAgentView {
  kind: 'managed' | 'external';
  agentName: string;
  identityId?: string;
  fingerprint?: string;
  apiUrl?: string;
  configDir?: string;
  createdAt: string;
  hasAgentKey?: boolean;
  hasPrivateKey?: boolean;
}

export interface ServeProviderView {
  api: string;
  baseUrl: string;
  envName: string;
  models: string[];
  hasApiKey: boolean;
}

export interface ServeRunView {
  id: string;
  agent: string;
  teamId: string;
  profiles: string[];
  taskTypes: string[];
  mode: 'poll' | 'drain';
  status: 'running' | 'exited' | 'stopped' | 'failed';
  pid?: number;
  exitCode?: number | null;
  startedAt: string;
  endedAt?: string;
  active: boolean;
}

export interface ServeStatus {
  version: string;
  platform: string;
  agents: ServeAgentView[];
  providers: Record<string, ServeProviderView>;
  runs: ServeRunView[];
}

export interface CreateAgentBody {
  kind: 'managed' | 'external';
  name: string;
  apiUrl?: string;
  enrollmentToken?: string;
  configDir?: string;
}

export interface PutProviderBody {
  api: string;
  baseUrl: string;
  envName: string;
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
  health(): Promise<boolean>;
  startPairing(): Promise<{ pairingId: string; approvalPath: string }>;
  claimPairing(pairingId: string): Promise<{ token: string }>;
  approvalUrl(approvalPath: string): string;
  status(): Promise<ServeStatus>;
  createAgent(body: CreateAgentBody): Promise<ServeAgentView>;
  putProvider(id: string, body: PutProviderBody): Promise<ServeProviderView>;
  startRun(body: StartRunBody): Promise<ServeRunView>;
  stopRun(runId: string): Promise<void>;
  streamLogs(
    runId: string,
    onLine: (line: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

function loopbackUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '[::1]') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('serve companion URL must be plain loopback http');
  }
  return url;
}

export function createServeClient(options: {
  baseUrl: string;
  getToken: () => string | null;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}): ServeClient {
  const baseUrl = loopbackUrl(options.baseUrl);
  const base = baseUrl.href.replace(/\/$/, '');
  const fetchImpl = options.fetch ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? READ_TIMEOUT_MS;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    requestOptions: {
      timeoutMs?: number | null;
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
        signal:
          requestOptions.timeoutMs === null
            ? undefined
            : AbortSignal.timeout(requestOptions.timeoutMs ?? requestTimeoutMs),
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
    return (await response.json()) as T;
  }

  return {
    baseUrl: base,
    async health(): Promise<boolean> {
      try {
        const response = await fetchImpl(`${base}/health`, {
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(2_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    startPairing() {
      return request('POST', '/v1/pairings');
    },
    claimPairing(pairingId: string) {
      return request('POST', `/v1/pairings/${pairingId}/claim`);
    },
    approvalUrl(approvalPath: string): string {
      return `${base}${approvalPath}`;
    },
    status() {
      return request('GET', '/v1/status');
    },
    createAgent(body: CreateAgentBody) {
      return request('POST', '/v1/agents', body, {
        timeoutMs: null,
      });
    },
    putProvider(id: string, body: PutProviderBody) {
      return request('PUT', `/v1/providers/${id}`, body, {
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
    },
    startRun(body: StartRunBody) {
      return request('POST', '/v1/runs', body, {
        timeoutMs: null,
      });
    },
    async stopRun(runId: string): Promise<void> {
      await request('DELETE', `/v1/runs/${runId}`);
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
      const response = await fetchImpl(`${base}/v1/runs/${runId}/logs`, {
        credentials: 'omit',
        redirect: 'error',
        headers,
        signal,
      });
      if (!response.ok) throw await responseError(response);
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
          if (buffer.length > MAX_SSE_EVENT_CHARS) {
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
    const problem = (await response.json()) as {
      code?: string;
      message?: string;
    };
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
