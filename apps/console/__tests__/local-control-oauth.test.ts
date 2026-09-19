import { webcrypto } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authorizeLocalControl } from '../src/runtime-local/local-control-oauth.js';

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    oauthIssuer: 'https://ory.example',
    oauthPublicUrl: 'https://ory.example',
  }),
}));
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  class TestAbortSignal extends AbortSignal {
    static override any(signals: AbortSignal[]): AbortSignal {
      const combined = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) combined.abort(signal.reason);
        else
          signal.addEventListener(
            'abort',
            () => combined.abort(signal.reason),
            { once: true },
          );
      }
      return combined.signal;
    }
  }
  vi.stubGlobal('AbortSignal', TestAbortSignal);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Console PKCE callback boundary', () => {
  it('ignores wrong source, origin and state and exchanges once with the original verifier', async () => {
    let opened!: (value: string) => void;
    const navigation = new Promise<string>((resolve) => {
      opened = resolve;
    });
    const popup = {
      closed: false,
      location: { replace: opened },
    } as unknown as Window;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).endsWith('/oauth/metadata'))
        return Response.json({
          issuer: 'https://ory.example',
          instance: 'server-instance',
          clientId: 'console',
          operatorConfigured: true,
        });
      return Response.json({ access_token: 'local-only', expires_in: 900 });
    });
    vi.stubGlobal('fetch', fetcher);
    const pending = authorizeLocalControl(
      'http://127.0.0.1:17374',
      popup,
      new AbortController().signal,
    );
    const url = new URL(await navigation);
    const state = url.searchParams.get('state');
    const emit = (
      source: Window,
      origin: string,
      callbackState: string | null,
    ) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source,
          origin,
          data: {
            type: 'moltnet-oauth-callback',
            code: 'approved',
            state: callbackState,
          },
        }),
      );
    emit(window, window.location.origin, state);
    emit(popup, 'https://untrusted.example', state);
    emit(popup, window.location.origin, 'incorrect');
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    emit(popup, window.location.origin, state);
    const token = await pending;
    expect(token.accessToken).toBe('local-only');
    expect(token.expiresAt).toBeLessThanOrEqual(Date.now() + 900_000);
    expect(token.expiresAt).toBeGreaterThan(Date.now());
    expect(fetcher).toHaveBeenCalledTimes(2);
    const form = fetcher.mock.calls[1][1]?.body as URLSearchParams;
    const digest = await webcrypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(form.get('code_verifier')!),
    );
    expect(Buffer.from(digest).toString('base64url')).toBe(
      url.searchParams.get('code_challenge'),
    );
    expect(form.get('code')).toBe('approved');
    expect(form.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'));
    expect(fetcher.mock.calls[1][1]?.credentials).toBe('omit');
  });

  it('cancels while awaiting the callback without an exchange', async () => {
    let opened!: () => void;
    const navigation = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const popup = {
      closed: false,
      location: { replace: opened },
    } as unknown as Window;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        issuer: 'https://ory.example',
        instance: 'server-instance',
        clientId: 'console',
        operatorConfigured: true,
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const pending = authorizeLocalControl(
      'http://127.0.0.1:17374',
      popup,
      controller.signal,
    );
    const rejection = expect(pending).rejects.toThrow('cancelled');
    await navigation;
    controller.abort();
    await rejection;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
