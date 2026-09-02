import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocalRuntime } from '../src/runtime-local/useLocalRuntime.js';
import { createTestWrapper } from './test-query-client.js';

const SERVE_URL = 'http://127.0.0.1:17374';
const TOKEN_KEY = `moltnet-serve-token::${SERVE_URL}`;

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ serveUrl: SERVE_URL }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function serveStatus() {
  return {
    version: 'test',
    platform: 'darwin',
    agents: [],
    providers: {},
    runs: [],
  };
}

function popupFixture() {
  return {
    closed: false,
    opener: window,
    close: vi.fn(),
    focus: vi.fn(),
    location: { replace: vi.fn() },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  sessionStorage.clear();
});

describe('useLocalRuntime', () => {
  it('restores a valid tab token and clears a rejected one', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'stored-token');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          { code: 'pairing_required', message: 'Pairing token is required' },
          401,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useLocalRuntime(), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.status).toBe('unpaired'));
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it.each([
    [500, 'degraded', 'stored-token'],
    [401, 'unpaired', null],
  ] as const)(
    'handles a %s response from periodic status polling',
    async (responseStatus, expectedStatus, expectedToken) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      sessionStorage.setItem(TOKEN_KEY, 'stored-token');
      let statusCalls = 0;
      const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        statusCalls += 1;
        if (statusCalls <= 2) {
          return Promise.resolve(jsonResponse(serveStatus()));
        }
        return Promise.resolve(
          jsonResponse(
            responseStatus === 401
              ? { code: 'pairing_required', message: 'Pair again' }
              : { code: 'internal_error', message: 'status failed' },
            responseStatus,
          ),
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useLocalRuntime(), {
        wrapper: createTestWrapper(),
      });
      await waitFor(() => {
        expect(result.current.status).toBe('connected');
        expect(statusCalls).toBeGreaterThanOrEqual(2);
      });
      await act(() => vi.advanceTimersByTimeAsync(5_100));
      await waitFor(() => expect(result.current.status).toBe(expectedStatus));

      expect(sessionStorage.getItem(TOKEN_KEY)).toBe(expectedToken);
      if (responseStatus === 500) {
        expect(result.current.connectionError).toBe('status failed');
      }
    },
  );

  it('opens a placeholder synchronously and persists an approved token', async () => {
    const popup = popupFixture();
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((input, init) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        if (url.endsWith('/v1/pairings') && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse(
              { pairingId: 'pair-1', approvalPath: '/pairings/pair-1' },
              201,
            ),
          );
        }
        if (url.endsWith('/v1/pairings/pair-1/claim')) {
          return Promise.resolve(jsonResponse({ token: 'approved-token' }));
        }
        if (url.endsWith('/v1/status')) {
          return Promise.resolve(jsonResponse(serveStatus()));
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLocalRuntime(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe('unpaired'));

    let pairing: Promise<void>;
    act(() => {
      pairing = result.current.pair();
    });

    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank', 'popup');
    expect(popup.opener).toBeNull();
    await act(() => pairing!);
    expect(popup.location.replace).toHaveBeenCalledWith(
      `${SERVE_URL}/pairings/pair-1`,
    );
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('approved-token');
    expect(result.current.status).toBe('connected');
  });

  it('exposes an approval fallback and cancels stale pairing completion', async () => {
    let resolveStart:
      | ((value: Response | PromiseLike<Response>) => void)
      | undefined;
    vi.spyOn(window, 'open').mockReturnValue(null);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      if (url.endsWith('/v1/pairings')) {
        return new Promise<Response>((resolve) => {
          resolveStart = resolve;
        });
      }
      return Promise.resolve(jsonResponse(serveStatus()));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLocalRuntime(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe('unpaired'));

    let pairing: Promise<void>;
    act(() => {
      pairing = result.current.pair();
    });
    resolveStart?.(
      jsonResponse(
        { pairingId: 'pair-2', approvalPath: '/pairings/pair-2' },
        201,
      ),
    );
    await waitFor(() =>
      expect(result.current.pairingApprovalUrl).toBe(
        `${SERVE_URL}/pairings/pair-2`,
      ),
    );
    expect(result.current.actionError).toContain('Popup blocked');

    act(() => result.current.disconnect());
    await act(() => pairing!);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(result.current.status).toBe('unpaired');
  });

  it('retries pending pairing claims until approval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const popup = popupFixture();
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    let claims = 0;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((input, init) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        if (url.endsWith('/v1/pairings') && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              pairingId: 'pair-3',
              approvalPath: '/pairings/pair-3',
            }),
          );
        }
        if (url.endsWith('/v1/pairings/pair-3/claim')) {
          claims += 1;
          return Promise.resolve(
            claims === 1
              ? jsonResponse(
                  { code: 'pairing_not_approved', message: 'Pending' },
                  401,
                )
              : jsonResponse({ token: 'eventual-token' }),
          );
        }
        if (url.endsWith('/v1/status')) {
          return Promise.resolve(jsonResponse(serveStatus()));
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLocalRuntime(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe('unpaired'));

    let pairing: Promise<void>;
    act(() => {
      pairing = result.current.pair();
    });
    await act(() => vi.advanceTimersByTimeAsync(2_100));
    await act(() => pairing!);

    expect(claims).toBe(2);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('eventual-token');
    expect(result.current.status).toBe('connected');
  });

  it('surfaces terminal pairing errors without retrying', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(window, 'open').mockReturnValue(
      popupFixture() as unknown as Window,
    );
    let claims = 0;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((input, init) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        if (url.endsWith('/v1/pairings') && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              pairingId: 'pair-4',
              approvalPath: '/pairings/pair-4',
            }),
          );
        }
        if (url.endsWith('/v1/pairings/pair-4/claim')) {
          claims += 1;
          return Promise.resolve(
            jsonResponse(
              { code: 'pairing_expired', message: 'Pairing expired' },
              410,
            ),
          );
        }
        return Promise.resolve(new Response(null, { status: 200 }));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLocalRuntime(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe('unpaired'));

    let pairing: Promise<void>;
    act(() => {
      pairing = result.current.pair();
    });
    await act(() => vi.advanceTimersByTimeAsync(1_100));
    await act(() => pairing!);

    expect(claims).toBe(1);
    expect(result.current.actionError).toBe('Pairing expired');
    expect(result.current.status).toBe('unpaired');
  });

  it('times out pairing approval after the bounded claim window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.spyOn(window, 'open').mockReturnValue(
      popupFixture() as unknown as Window,
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((input, init) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        if (url.endsWith('/v1/pairings') && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              pairingId: 'pair-5',
              approvalPath: '/pairings/pair-5',
            }),
          );
        }
        if (url.endsWith('/v1/pairings/pair-5/claim')) {
          return Promise.resolve(
            jsonResponse(
              { code: 'pairing_not_approved', message: 'Pending' },
              401,
            ),
          );
        }
        return Promise.resolve(new Response(null, { status: 200 }));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLocalRuntime(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe('unpaired'));

    let pairing: Promise<void>;
    act(() => {
      pairing = result.current.pair();
    });
    await act(() => vi.advanceTimersByTimeAsync(121_000));
    await act(() => pairing!);

    expect(result.current.actionError).toContain('timed out');
    expect(result.current.status).toBe('unpaired');
  });

  it('executes every mutation action and reconciles status after success', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'stored-token');
    let statusCalls = 0;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((input, init) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        if (url.endsWith('/v1/status')) {
          statusCalls += 1;
          return Promise.resolve(jsonResponse(serveStatus()));
        }
        if (url.endsWith('/v1/agents') && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse(
              { kind: 'managed', agentName: 'bot', createdAt: 't' },
              201,
            ),
          );
        }
        if (url.endsWith('/v1/providers/test') && init?.method === 'PUT') {
          return Promise.resolve(
            jsonResponse({
              api: 'openai-completions',
              baseUrl: 'https://provider.example/v1',
              envName: 'MOLTNET_PROVIDER_TEST_API_KEY',
              models: ['model'],
              hasApiKey: true,
            }),
          );
        }
        if (url.endsWith('/v1/runs') && init?.method === 'POST') {
          return Promise.resolve(
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
          );
        }
        if (url.endsWith('/v1/runs/run-1') && init?.method === 'DELETE') {
          return Promise.resolve(jsonResponse({ status: 'stopped' }));
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLocalRuntime(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe('connected'));
    const initialStatusCalls = statusCalls;

    await act(() =>
      result.current.createAgent({ kind: 'managed', name: 'bot' }),
    );
    await act(() =>
      result.current.putProvider('test', {
        api: 'openai-completions',
        baseUrl: 'https://provider.example/v1',
        models: ['model'],
        apiKey: 'secret',
      }),
    );
    await act(() =>
      result.current.startRun({
        agent: 'bot',
        teamId: 'team',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
      }),
    );
    await act(() => result.current.stopRun('run-1'));

    expect(statusCalls).toBe(initialStatusCalls + 4);
    expect(result.current.actionError).toBeNull();
  });

  it.each(['createAgent', 'putProvider', 'startRun', 'stopRun'] as const)(
    'reconciles status and surfaces %s failures',
    async (action) => {
      sessionStorage.setItem(TOKEN_KEY, 'stored-token');
      let statusCalls = 0;
      const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        if (url.endsWith('/v1/status')) {
          statusCalls += 1;
          return Promise.resolve(jsonResponse(serveStatus()));
        }
        return Promise.resolve(
          jsonResponse(
            { code: 'mutation_failed', message: `${action} failed` },
            500,
          ),
        );
      });
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderHook(() => useLocalRuntime(), {
        wrapper: createTestWrapper(),
      });
      await waitFor(() => expect(result.current.status).toBe('connected'));
      const initialStatusCalls = statusCalls;

      const mutation =
        action === 'createAgent'
          ? result.current.createAgent({ kind: 'managed', name: 'bot' })
          : action === 'putProvider'
            ? result.current.putProvider('test', {
                api: 'openai-completions',
                baseUrl: 'https://provider.example/v1',
                models: ['model'],
              })
            : action === 'startRun'
              ? result.current.startRun({
                  agent: 'bot',
                  teamId: 'team',
                  profiles: ['profile'],
                  taskTypes: ['freeform'],
                  mode: 'poll',
                })
              : result.current.stopRun('run-1');

      await act(() => expect(mutation).rejects.toThrow(`${action} failed`));
      expect(statusCalls).toBe(initialStatusCalls + 1);
      expect(result.current.actionError).toBe(`${action} failed`);
    },
  );
});
