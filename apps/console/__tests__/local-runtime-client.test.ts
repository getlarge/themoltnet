// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  createServeClient,
  SERVE_TOKEN_HEADER,
  ServeClientError,
} from '../src/runtime-local/serve-client.js';

const BASE = 'http://127.0.0.1:17374';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('serve companion client', () => {
  it('refuses non-loopback base URLs', () => {
    for (const baseUrl of [
      'https://evil.example',
      'http://serve.example',
      'http://user:pw@127.0.0.1:17374',
    ]) {
      expect(() =>
        createServeClient({ baseUrl, getToken: () => null }),
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
          agents: [],
          providers: {},
          runs: [],
        }),
      );
    let token: string | null = null;
    const client = createServeClient({
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
    expect(first.headers.has(SERVE_TOKEN_HEADER)).toBe(false);
    const second = new Request(
      fetchMock.mock.calls[1][0] as string,
      fetchMock.mock.calls[1][1],
    );
    expect(second.headers.get(SERVE_TOKEN_HEADER)).toBe('paired-token');
  });

  it('maps serve problem responses onto typed errors', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { code: 'pairing_required', message: 'Pairing token is required' },
          401,
        ),
      );
    const client = createServeClient({
      baseUrl: BASE,
      getToken: () => null,
      fetch: fetchMock,
    });
    try {
      await client.status();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ServeClientError);
      expect((error as ServeClientError).code).toBe('pairing_required');
      expect((error as ServeClientError).status).toBe(401);
    }
  });

  it('parses SSE data lines from the log stream', async () => {
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
    const client = createServeClient({
      baseUrl: BASE,
      getToken: () => 'tok',
      fetch: fetchMock,
    });
    const lines: string[] = [];
    await client.streamLogs(
      'run-1',
      (line) => lines.push(line),
      new AbortController().signal,
    );
    expect(lines).toEqual(['first line', 'second line']);
  });
});
