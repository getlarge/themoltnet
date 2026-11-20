// Disposable OIDC test double. No upstream account, persisted key or real mail.
import { createServer } from 'node:http';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';

const issuer = process.env.OIDC_MOCK_ISSUER ?? 'http://oidc-mock:8080';
const port = Number(process.env.OIDC_MOCK_PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid mock port');
const browserUrl = process.env.OIDC_MOCK_BROWSER_URL;
const redirectUri = process.env.OIDC_MOCK_REDIRECT_URI;
if (!browserUrl || !redirectUri)
  throw new Error('Mock browser/callback URLs required');
const clientId = 'acceptance-mock';
// secretlint-disable-next-line @secretlint/secretlint-rule-preset-recommend -- synthetic fixture credential
const clientSecret = 'synthetic-oidc-fixture-secret';
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'mock-key',
  use: 'sig',
  alg: 'RS256',
};
let nonce = randomUUID().replaceAll('-', '').slice(0, 12);
let profile = {
  sub: `synthetic-${nonce}`,
  email: `mock-oidc-${nonce}@example.com`,
  email_verified: true,
  preferred_username: `mock_oidc_${nonce}`,
};
const codes = new Map();
const tokens = new Map();
const html = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const json = (res, status, value) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(value));
};
function jwt(payload) {
  const value = [
    JSON.stringify({ alg: 'RS256', kid: 'mock-key', typ: 'JWT' }),
    JSON.stringify(payload),
  ]
    .map((v) => Buffer.from(v).toString('base64url'))
    .join('.');
  return `${value}.${sign('RSA-SHA256', Buffer.from(value), privateKey).toString('base64url')}`;
}
async function body(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 16384) throw new Error('request too large');
  }
  return new URLSearchParams(value);
}
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, issuer);
    if (url.pathname === '/test/reset' && req.method === 'POST') {
      nonce = randomUUID().replaceAll('-', '').slice(0, 12);
      profile = {
        sub: `synthetic-${nonce}`,
        email: `mock-oidc-${nonce}@example.com`,
        email_verified: true,
        preferred_username: `mock_oidc_${nonce}`,
      };
      codes.clear();
      tokens.clear();
      return json(res, 200, { ready: true });
    }
    if (url.pathname === '/health') return json(res, 200, { ready: true });
    if (url.pathname === '/.well-known/openid-configuration')
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${browserUrl}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: ['openid', 'profile', 'email'],
        token_endpoint_auth_methods_supported: [
          'client_secret_basic',
          'client_secret_post',
        ],
        claims_supported: [
          'sub',
          'email',
          'email_verified',
          'preferred_username',
        ],
      });
    if (url.pathname === '/jwks') return json(res, 200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      const params = req.method === 'POST' ? await body(req) : url.searchParams;
      if (
        params.get('client_id') !== clientId ||
        params.get('redirect_uri') !== redirectUri ||
        params.get('response_type') !== 'code' ||
        !params.get('state')
      )
        return json(res, 400, { error: 'invalid_request' });
      if (req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/html',
          'cache-control': 'no-store',
        });
        return res.end(
          `<html lang="en"><title>Mock identity provider</title><h1>Mock identity provider</h1><p>Synthetic account only</p><form method="post">${[...params].map(([k, v]) => `<input type="hidden" name="${html(k)}" value="${html(v)}">`).join('')}<button>Continue as synthetic user</button></form></html>`,
        );
      }
      const code = randomUUID();
      codes.set(code, {
        nonce: params.get('nonce'),
        until: Date.now() + 60_000,
      });
      const callback = new URL(redirectUri);
      callback.searchParams.set('state', params.get('state'));
      callback.searchParams.set('code', code);
      res.writeHead(302, {
        location: callback.href,
        'cache-control': 'no-store',
      });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const params = await body(req);
      const auth = req.headers.authorization?.startsWith('Basic ')
        ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString()
        : `${params.get('client_id')}:${params.get('client_secret')}`;
      if (auth !== `${clientId}:${clientSecret}`)
        return json(res, 401, { error: 'invalid_client' });
      const code = params.get('code');
      const grant = codes.get(code);
      codes.delete(code);
      if (
        !grant ||
        grant.until < Date.now() ||
        params.get('redirect_uri') !== redirectUri ||
        params.get('grant_type') !== 'authorization_code'
      )
        return json(res, 400, { error: 'invalid_grant' });
      const token = randomUUID();
      tokens.set(token, Date.now() + 120_000);
      const now = Math.floor(Date.now() / 1000);
      return json(res, 200, {
        token_type: 'Bearer',
        access_token: token,
        expires_in: 120,
        scope: 'openid profile email',
        id_token: jwt({
          ...profile,
          iss: issuer,
          aud: clientId,
          iat: now,
          exp: now + 120,
          ...(grant.nonce ? { nonce: grant.nonce } : {}),
        }),
      });
    }
    if (url.pathname === '/userinfo') {
      if (
        (tokens.get(req.headers.authorization?.replace(/^Bearer /, '')) ?? 0) <
        Date.now()
      )
        return json(res, 401, { error: 'invalid_token' });
      return json(res, 200, profile);
    }
    return json(res, 404, { error: 'not_found' });
  } catch {
    return json(res, 400, { error: 'invalid_request' });
  }
}).listen(port, process.env.OIDC_MOCK_HOST ?? '0.0.0.0', () =>
  console.log('Synthetic OIDC fixture ready'),
);
