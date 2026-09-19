import { getConfig } from '../config.js';
import { loopbackFetch, loopbackUrl } from '../loopback-url.js';

/** Tokens and verifier live only in this tab; callbacks transfer only the code. */
export async function authorizeLocalControl(
  baseUrl: string,
  popup: Window | null,
  signal: AbortSignal,
): Promise<string> {
  if (!popup) throw new Error('Allow popups to sign in to local control.');
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
  const meta = (await response.json()) as {
    issuer: string;
    clientId: string;
    instance: string;
    operatorConfigured: boolean;
  };
  const issuer = getConfig().oauthIssuer;
  if (meta.issuer !== issuer || !meta.operatorConfigured)
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
    client_id: meta.clientId,
    response_type: 'code',
    redirect_uri: callback,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'moltnet:local-control',
    audience: 'moltnet:agent-server',
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
    const receive = (event: MessageEvent) => {
      if (
        event.source !== popup ||
        event.origin !== window.location.origin ||
        event.data?.type !== 'moltnet-oauth-callback'
      )
        return;
      if (event.data.state !== state) return;
      cleanup();
      if (
        typeof event.data.code !== 'string' ||
        !event.data.code ||
        event.data.error
      )
        reject(new Error('Approval declined'));
      else resolve(event.data.code);
    };
    const deadline = Date.now() + 300_000;
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
        client_id: meta.clientId,
        redirect_uri: callback,
      }),
    },
  );
  if (!exchange.ok)
    throw new Error('Sign-in exchange failed. Request fresh approval.');
  const tokens = (await exchange.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!tokens.access_token || tokens.refresh_token)
    throw new Error('Invalid local-control response');
  return tokens.access_token;
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
