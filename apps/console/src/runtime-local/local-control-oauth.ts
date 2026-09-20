import { OPERATOR_OAUTH } from '@moltnet/models';

import { getConfig } from '../config.js';
import { loopbackFetch, loopbackUrl } from '../loopback-url.js';
import type { LocalControlToken } from './local-control-token-cache.js';

/** Tokens and verifier live only in this tab; callbacks transfer only the code. */
export async function authorizeLocalControl(
  baseUrl: string,
  popup: Window | null,
  signal: AbortSignal,
): Promise<LocalControlToken> {
  if (!popup) throw new Error('Allow popups to sign in to local control.');
  const config = getConfig();
  const localUrl = loopbackUrl(baseUrl, 'Agent Server');
  // HTTP is an explicit same-machine development choice, never a fallback
  // from a hosted Console after TLS authentication fails.
  if (
    localUrl.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  )
    throw new Error(
      'Local control requires HTTPS. Start Agent Server and approve local trust in Desktop.',
    );
  const response = await loopbackFetch(
    fetch,
    new URL('/oauth/metadata', loopbackUrl(baseUrl, 'Agent Server')).href,
    {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    },
  );
  if (!response.ok) throw new Error('Local OAuth is not configured.');
  const meta: unknown = await response.json();
  if (
    !meta ||
    typeof meta !== 'object' ||
    !('issuer' in meta) ||
    meta.issuer !== config.oauthIssuer ||
    !('clientId' in meta) ||
    meta.clientId !== config.oauthConsoleClientId ||
    !('instance' in meta) ||
    typeof meta.instance !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      meta.instance,
    ) ||
    !('operatorConfigured' in meta) ||
    typeof meta.operatorConfigured !== 'boolean'
  )
    throw new Error(
      'Local authorization configuration does not match this Console. Check Server settings.',
    );
  if (!meta.operatorConfigured)
    throw new Error(
      'Sign in through Desktop to establish the local operator first.',
    );
  const state = random();
  const verifier = random();
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  const challenge = encode(new Uint8Array(hash));
  const callback = new URL('/oauth/local-callback', window.location.origin)
    .href;
  const url = new URL('/oauth2/auth', getConfig().oauthPublicUrl);
  for (const [key, value] of Object.entries({
    client_id: config.oauthConsoleClientId,
    response_type: 'code',
    redirect_uri: callback,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: OPERATOR_OAUTH.localControlScope,
    audience: OPERATOR_OAUTH.localControlAudience,
    instance: meta.instance,
    prompt: 'consent',
  }))
    url.searchParams.set(key, value);
  const code = await new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      clearInterval(timer);
    };
    const abort = () => {
      cleanup();
      reject(new Error('Sign-in cancelled'));
    };
    const receive = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        !data ||
        typeof data !== 'object' ||
        !('type' in data) ||
        !('state' in data)
      )
        return;
      if (
        event.source !== popup ||
        event.origin !== window.location.origin ||
        data.type !== 'moltnet-oauth-callback'
      )
        return;
      if (data.state !== state) return;
      cleanup();
      if (
        !('code' in data) ||
        typeof data.code !== 'string' ||
        !data.code ||
        ('error' in data && data.error)
      )
        reject(new Error('Approval declined'));
      else resolve(data.code);
    };
    const deadline = Date.now() + OPERATOR_OAUTH.nativeLifetimeSeconds * 1000;
    const timer = setInterval(() => {
      if (popup.closed || Date.now() >= deadline) abort();
    }, 500);
    signal.addEventListener('abort', abort, { once: true });
    window.addEventListener('message', receive);
    if (signal.aborted) {
      abort();
      return;
    }
    popup.location.replace(url.href);
  });
  const exchangeStartedAt = Date.now();
  const exchange = await fetch(
    new URL('/oauth2/token', getConfig().oauthPublicUrl),
    {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: config.oauthConsoleClientId,
        redirect_uri: callback,
      }),
    },
  );
  if (!exchange.ok)
    throw new Error('Sign-in exchange failed. Request fresh approval.');
  const tokens = (await exchange.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (
    !tokens.access_token ||
    tokens.refresh_token ||
    typeof tokens.expires_in !== 'number' ||
    !Number.isFinite(tokens.expires_in) ||
    tokens.expires_in <= 0
  )
    throw new Error('Invalid local-control response');
  return {
    accessToken: tokens.access_token,
    expiresAt:
      exchangeStartedAt +
      Math.min(tokens.expires_in, OPERATOR_OAUTH.consoleLifetimeSeconds) * 1000,
  };
}
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function random() {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}
