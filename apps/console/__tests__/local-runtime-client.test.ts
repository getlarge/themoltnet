// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_SERVER_TOKEN_HEADER,
  AgentServerClientError,
  createAgentServerClient,
} from '../src/runtime-local/agent-server-client.js';

const BASE = 'http://127.0.0.1:17374';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('agent server client', () => {
  it('refuses non-loopback base URLs', () => {
    for (const baseUrl of [
      'https://evil.example',
      'http://agent-server.example',
      'http://user:pw@127.0.0.1:17374',
      'http://127.0.0.1:17374/prefix',
      'http://127.0.0.1:17374?target=other',
      'http://127.0.0.1:17374#fragment',
    ]) {
      expect(() =>
        createAgentServerClient({ baseUrl, getToken: () => null }),
      ).toThrow('loopback');
    }
  });

  it('never sends browser credentials and attaches the pairing token', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ pairingId: 'p1', approvalPath: '/pairings/p1' }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          version: 'test',
          platform: 'darwin',
          subscriptions: [],
          agents: [],
          providers: {},
          runs: [],
        }),
      );
    let token: string | null = null;
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => token,
      fetch: fetchMock,
    });

    await client.startPairing();
    token = 'paired-token';
    await client.status();

    for (const [input, init] of fetchMock.mock.calls) {
      const request =
        input instanceof Request ? input : new Request(input as string, init);
      expect(request.url).toMatch(/^http:\/\/127\.0\.0\.1:17374\//);
      expect(request.credentials).toBe('omit');
      expect(request.headers.has('authorization')).toBe(false);
      expect(request.headers.has('cookie')).toBe(false);
    }
    const first = new Request(
      fetchMock.mock.calls[0][0] as string,
      fetchMock.mock.calls[0][1],
    );
    expect(first.headers.has(AGENT_SERVER_TOKEN_HEADER)).toBe(false);
    const second = new Request(
      fetchMock.mock.calls[1][0] as string,
      fetchMock.mock.calls[1][1],
    );
    expect(second.headers.get(AGENT_SERVER_TOKEN_HEADER)).toBe('paired-token');
  });

  it('maps Agent Server problem responses onto typed errors', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { code: 'pairing_required', message: 'Pairing token is required' },
          401,
        ),
      );
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => null,
      fetch: fetchMock,
    });
    try {
      await client.status();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentServerClientError);
      expect((error as AgentServerClientError).code).toBe('pairing_required');
      expect((error as AgentServerClientError).status).toBe(401);
    }
  });

  it('preserves typed health probe outcomes', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new DOMException('slow', 'TimeoutError'))
      .mockRejectedValueOnce(new TypeError('offline'));
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => null,
      fetch: fetchMock,
    });

    await expect(client.health()).resolves.toEqual({ status: 'ok' });
    await expect(client.health()).resolves.toEqual({
      status: 'incompatible',
      httpStatus: 503,
    });
    await expect(client.health()).resolves.toEqual({
      status: 'unavailable',
      reason: 'timeout',
    });
    await expect(client.health()).resolves.toEqual({
      status: 'unavailable',
      reason: 'network',
    });
  });

  it('rejects incompatible JSON response shapes', async () => {
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => 'tok',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          version: 'test',
          platform: 'darwin',
          subscriptions: [],
          agents: [],
          providers: {},
          runs: [{ id: 'missing-required-fields' }],
        }),
      ),
    });

    await expect(client.status()).rejects.toThrow('invalid status response');
  });

  it('sends mutation routes and bodies without browser credentials', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { kind: 'managed', agentName: 'bot', createdAt: 't' },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          api: 'openai-completions',
          baseUrl: 'https://provider.example',
          envName: 'MOLTNET_PROVIDER_TEST_API_KEY',
          models: ['model'],
          hasApiKey: true,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: 'run-1',
            agent: 'bot',
            teamId: 'team',
            profiles: ['profile'],
            taskTypes: ['freeform'],
            mode: 'poll',
            status: 'running',
            startedAt: 't',
            active: true,
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'stopped' }));
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => 'tok',
      fetch: fetchMock,
    });

    await client.createAgent({
      kind: 'managed',
      name: 'bot',
      enrollmentToken: 'enroll-token',
    });
    await client.putProvider('test', {
      api: 'openai-completions',
      baseUrl: 'https://provider.example',
      models: ['model'],
      apiKey: 'write-only',
    });
    await client.startRun({
      agent: 'bot',
      teamId: 'team',
      profiles: ['profile'],
      taskTypes: ['freeform'],
      mode: 'poll',
    });
    await client.stopRun('run-1');

    expect(
      fetchMock.mock.calls.map(([input, init]) => ({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })),
    ).toEqual([
      {
        url: `${BASE}/v1/agents`,
        method: 'POST',
        body: {
          kind: 'managed',
          name: 'bot',
          enrollmentToken: 'enroll-token',
        },
      },
      {
        url: `${BASE}/v1/providers/test`,
        method: 'PUT',
        body: {
          api: 'openai-completions',
          baseUrl: 'https://provider.example',
          envName: 'MOLTNET_PROVIDER_TEST_API_KEY',
          models: ['model'],
          apiKey: 'write-only',
        },
      },
      {
        url: `${BASE}/v1/runs`,
        method: 'POST',
        body: {
          agent: 'bot',
          teamId: 'team',
          profiles: ['profile'],
          taskTypes: ['freeform'],
          mode: 'poll',
        },
      },
      {
        url: `${BASE}/v1/runs/run-1`,
        method: 'DELETE',
        body: undefined,
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[2]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[3]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('derives provider env names and rejects secret-bearing provider URLs', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => 'tok',
      fetch: fetchMock,
    });
    const body = {
      api: 'openai-completions',
      models: ['model'],
    };

    for (const baseUrl of [
      'https://user:secret@provider.example/v1',
      'https://provider.example/v1?api_key=secret',
      'https://provider.example/v1#secret',
      'file:///tmp/provider',
    ]) {
      await expect(
        client.putProvider('ollama-cloud', { ...body, baseUrl }),
      ).rejects.toMatchObject({ code: 'invalid_provider_url' });
    }
    await expect(
      client.putProvider('../escape', {
        ...body,
        baseUrl: 'https://provider.example/v1',
      }),
    ).rejects.toMatchObject({ code: 'invalid_provider_id' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates subscription polling cancellation into the HTTP request', async () => {
    let requestSignal: AbortSignal | null = null;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal ?? null;
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => 'tok',
      fetch: fetchMock,
    });
    const controller = new AbortController();

    const polling = client.subscriptionLoginStatus(
      'anthropic',
      controller.signal,
    );
    await vi.waitFor(() => expect(requestSignal).not.toBeNull());
    controller.abort();

    await expect(polling).rejects.toMatchObject({
      code: 'agent_server_unavailable',
    });
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it('parses SSE lines and preserves stream request invariants', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: first line\n\ndata: sec'));
        controller.enqueue(encoder.encode('ond line\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => 'tok',
      fetch: fetchMock,
    });
    const lines: string[] = [];
    const controller = new AbortController();
    await client.streamLogs(
      'run-1',
      (line) => lines.push(line),
      controller.signal,
    );
    expect(lines).toEqual(['first line', 'second line']);
    const [input, init] = fetchMock.mock.calls[0];
    const request = new Request(input as string, init);
    expect(request.url).toBe(`${BASE}/v1/runs/run-1/logs`);
    expect(request.credentials).toBe('omit');
    expect(request.redirect).toBe('error');
    expect(request.headers.get(AGENT_SERVER_TOKEN_HEADER)).toBe('tok');
    expect(request.headers.has('authorization')).toBe(false);
    expect(request.headers.has('cookie')).toBe(false);
    expect(init?.signal).toBe(controller.signal);
  });

  it('maps log authorization and empty-stream failures', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ code: 'pairing_required', message: 'Pair again' }, 401),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('not an event stream', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => 'tok',
      fetch: fetchMock,
    });
    const signal = new AbortController().signal;

    await expect(
      client.streamLogs('run-1', vi.fn(), signal),
    ).rejects.toMatchObject({ code: 'pairing_required', status: 401 });
    await expect(
      client.streamLogs('run-1', vi.fn(), signal),
    ).rejects.toMatchObject({ code: 'logs_unavailable' });
    await expect(
      client.streamLogs('run-1', vi.fn(), signal),
    ).rejects.toMatchObject({ code: 'logs_invalid_content_type' });
  });

  it('rejects oversized SSE events from a replacement listener', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('x'.repeat(256 * 1024 + 1)),
        );
      },
      cancel,
    });
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => 'tok',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(stream, {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    });

    await expect(
      client.streamLogs('run-1', vi.fn(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'logs_event_too_large' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('accepts a maximum-sized log payload without counting the SSE prefix', async () => {
    const payload = 'x'.repeat(256 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
        controller.close();
      },
    });
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => 'tok',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(stream, {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    });
    const lines: string[] = [];

    await client.streamLogs(
      'run-1',
      (line) => lines.push(line),
      new AbortController().signal,
    );

    expect(lines).toEqual([payload]);
  });

  it('accepts a fragmented maximum-sized payload consistently', async () => {
    const payload = 'x'.repeat(256 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: '));
        controller.enqueue(encoder.encode(payload));
        controller.enqueue(encoder.encode('\n\n'));
        controller.close();
      },
    });
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => 'tok',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(stream, {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    });
    const lines: string[] = [];

    await client.streamLogs(
      'run-1',
      (line) => lines.push(line),
      new AbortController().signal,
    );

    expect(lines).toEqual([payload]);
  });

  it('propagates log-stream aborts to fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    const client = createAgentServerClient({
      baseUrl: BASE,
      getToken: () => 'tok',
      fetch: fetchMock,
    });
    const controller = new AbortController();

    const streaming = client.streamLogs('run-1', vi.fn(), controller.signal);
    controller.abort(new DOMException('aborted', 'AbortError'));

    await expect(streaming).rejects.toMatchObject({ name: 'AbortError' });
  });
});
