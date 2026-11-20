import { ResponseError } from '@ory/client-fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearFlowRestart,
  flowFailure,
  flowSearch,
  loadFlow,
  navigateToOryRedirect,
  rememberFlowRestart,
} from '../src/auth/flows.js';

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ kratosUrl: 'https://auth.example.test' }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('browser flow integration', () => {
  it('requests JSON rather than following UI redirects and preserves authentication context', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '11111111-1111-4111-8111-111111111111',
          type: 'browser',
          issued_at: '2026-11-20T00:00:00Z',
          expires_at: '2026-11-20T01:00:00Z',
          request_url: 'https://auth.example.test/self-service/login/browser',
          requested_aal: 'aal2',
          refresh: true,
          ui: {
            action: 'https://auth.example.test/self-service/login',
            method: 'POST',
            nodes: [],
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', request);
    const signal = new AbortController().signal;
    const search = new URLSearchParams({
      return_to: 'https://console.example.test/oauth?state=opaque',
      login_challenge: 'challenge',
      aal: 'aal2',
      refresh: 'true',
      arbitrary: 'must-not-forward',
    });

    await loadFlow('login', search, signal);

    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    const sent = new URL(url);
    expect(sent.pathname).toBe('/self-service/login/browser');
    expect(sent.searchParams.get('return_to')).toBe(search.get('return_to'));
    expect(sent.searchParams.get('login_challenge')).toBe('challenge');
    expect(sent.searchParams.get('aal')).toBe('aal2');
    expect(sent.searchParams.get('refresh')).toBe('true');
    expect(sent.searchParams.has('arbitrary')).toBe(false);
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
    expect(init.credentials).toBe('include');
    expect(init.signal).toBe(signal);
  });

  it('keeps the original error body readable for subsequent handlers', async () => {
    const response = new Response(
      JSON.stringify({
        error: { id: 'self_service_flow_expired' },
        use_flow_id: 'replacement-flow',
      }),
      { status: 410 },
    );
    const error = new ResponseError(response);

    expect(await flowFailure(error)).toEqual({
      status: 410,
      body: {
        error: { id: 'self_service_flow_expired' },
        use_flow_id: 'replacement-flow',
      },
    });
    expect(response.bodyUsed).toBe(false);
  });

  it('preserves OAuth context across an Elements restart and consumes it only after loading', () => {
    window.history.replaceState(
      null,
      '',
      '/auth/login?flow=old&return_to=%2Foauth&login_challenge=challenge&aal=aal2&refresh=true',
    );
    rememberFlowRestart('login');
    window.history.replaceState(
      null,
      '',
      '/auth/login?flow=restarted-without-context',
    );

    const restored = flowSearch('login');
    expect(restored.has('flow')).toBe(false);
    expect(restored.get('return_to')).toBe('/oauth');
    expect(restored.get('login_challenge')).toBe('challenge');
    expect(restored.get('aal')).toBe('aal2');
    expect(restored.get('refresh')).toBe('true');
    expect(flowSearch('login').toString()).toBe(restored.toString());
    clearFlowRestart();
    expect(flowSearch('login').get('flow')).toBe('restarted-without-context');
  });

  it('refuses executable redirect schemes', () => {
    expect(() => navigateToOryRedirect('javascript:alert(1)')).toThrow(
      'invalid redirect',
    );
    expect(() => navigateToOryRedirect('data:text/html,unsafe')).toThrow(
      'invalid redirect',
    );
  });
});
