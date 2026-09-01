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
    url.password
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
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = options.getToken();
    if (token) headers[SERVE_TOKEN_HEADER] = token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetchImpl(`${base}${path}`, {
      method,
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
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
        // keep defaults
      }
      throw new ServeClientError(code, message, response.status);
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
      return request('POST', '/v1/agents', body);
    },
    putProvider(id: string, body: PutProviderBody) {
      return request('PUT', `/v1/providers/${id}`, body);
    },
    startRun(body: StartRunBody) {
      return request('POST', '/v1/runs', body);
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
      if (!response.ok || !response.body) {
        throw new ServeClientError(
          'logs_unavailable',
          `log stream failed with ${response.status}`,
          response.status,
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (part.startsWith('data: ')) onLine(part.slice('data: '.length));
        }
      }
    },
  };
}
