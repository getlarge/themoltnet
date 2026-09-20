import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authorizeLocalControl } from '../src/runtime-local/local-control-oauth.js';
import { localControlTokens } from '../src/runtime-local/local-control-token-cache.js';
import { useLocalRuntime } from '../src/runtime-local/useLocalRuntime.js';
import { createTestWrapper } from './test-query-client.js';

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ agentServerUrl: 'http://127.0.0.1:17374' }),
}));
vi.mock('../src/runtime-local/local-control-oauth.js', () => ({
  authorizeLocalControl: vi.fn(),
}));
const status = {
  version: 'test',
  platform: 'linux',
  subscriptions: [],
  agents: [],
  identities: [],
  providers: {},
  runs: [],
};
let rejectToken = false;
beforeEach(() => {
  localControlTokens.clear();
  rejectToken = false;
  sessionStorage.clear();
  vi.mocked(authorizeLocalControl)
    .mockReset()
    .mockResolvedValue({
      accessToken: 'oauth-token',
      expiresAt: Date.now() + 900_000,
    });
  vi.spyOn(window, 'open').mockReturnValue({
    close: vi.fn(),
    closed: false,
  } as unknown as Window);
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).endsWith('/health')) return new Response('{}');
      return new Response(
        JSON.stringify(
          rejectToken
            ? { code: 'authorization_required', message: 'Sign in again' }
            : status,
        ),
        { status: rejectToken ? 401 : 200 },
      );
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('local OAuth connection', () => {
  it('keeps authorization in memory', async () => {
    const { result } = renderHook(() => useLocalRuntime(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe('unauthorized'));
    await act(() => result.current.authorize());
    await waitFor(() => expect(result.current.status).toBe('connected'));
    expect(sessionStorage.length).toBe(0);
  });
  it('drops authorization when the server expires or rejects it and reconnects through PKCE', async () => {
    const { result } = renderHook(() => useLocalRuntime(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe('unauthorized'));
    await act(() => result.current.authorize());
    rejectToken = true;
    await act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('unauthorized'));
    rejectToken = false;
    await act(() => result.current.authorize());
    expect(authorizeLocalControl).toHaveBeenCalledTimes(2);
  });
  it('reports cancellation and can retry', async () => {
    vi.mocked(authorizeLocalControl).mockRejectedValueOnce(
      new Error('Approval cancelled'),
    );
    const { result } = renderHook(() => useLocalRuntime(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe('unauthorized'));
    await act(() => result.current.authorize());
    expect(result.current.actionError).toBe('Approval cancelled');
    await act(() => result.current.authorize());
    expect(result.current.status).toBe('connected');
  });
});
