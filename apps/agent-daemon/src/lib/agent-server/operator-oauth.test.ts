import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OPERATOR_OAUTH } from '@moltnet/models';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';

import { type NativeProvisioning, OperatorOAuth } from './operator-oauth.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
async function fixture(
  beforeJwks?: () => Promise<void>,
  exchangeClaims: Record<string, unknown> = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'operator-oauth-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
  let authorization: URL;
  let issuer = '';
  let exchanges = 0;
  async function token(
    overrides: Record<string, unknown> = {},
    browser = true,
  ) {
    return new SignJWT({
      client_id: browser ? 'console' : 'native',
      scp: ['moltnet:local-control'],
      ext: {
        'moltnet:identity_id': 'human',
        'moltnet:subject_type': 'human',
        'moltnet:instance': oauth.instance,
      },
      ...overrides,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(issuer)
      .setSubject(typeof overrides.sub === 'string' ? overrides.sub : 'human')
      .setAudience(
        typeof overrides.aud === 'string'
          ? overrides.aud
          : 'moltnet:agent-server',
      )
      .setIssuedAt(
        typeof overrides.iat === 'number' ? overrides.iat : undefined,
      )
      .setExpirationTime(
        typeof overrides.exp === 'number' ? overrides.exp : '15m',
      )
      .sign(privateKey);
  }
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/.well-known/jwks.json') {
        await beforeJwks?.();
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      exchanges++;
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const form = new URLSearchParams(body);
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('code')).toBe('approved-code');
      expect(
        createHash('sha256')
          .update(form.get('code_verifier')!)
          .digest('base64url'),
      ).toBe(authorization.searchParams.get('code_challenge'));
      response.end(
        JSON.stringify({ access_token: await token(exchangeClaims, false) }),
      );
    })().catch((error: unknown) => {
      response.destroy(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  issuer = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const portProbe = createServer();
  await new Promise<void>((resolve) => {
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  const callbackPort = (portProbe.address() as { port: number }).port;
  await new Promise<void>((resolve) => {
    portProbe.close(() => resolve());
  });
  let opened!: (url: URL) => void;
  const openedPromise = new Promise<URL>((resolve) => {
    opened = resolve;
  });
  const config = {
    issuer,
    authorizationUrl: `${issuer}/oauth2/auth`,
    tokenUrl: `${issuer}/oauth2/token`,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    nativeClientId: 'native',
    callbackPort,
  };
  const oauth = new OperatorOAuth(config, root, (url) => {
    authorization = new URL(url);
    opened(authorization);
  });
  cleanup.push(() => oauth.cancel());
  return {
    oauth,
    config,
    root,
    openedPromise,
    token,
    exchanges: () => exchanges,
  };
}
describe('native PKCE operator', () => {
  it('rejects wrong state, exchanges once with its verifier, and stores no token', async () => {
    const f = await fixture();
    const pending = f.oauth.authorize();
    const url = await f.openedPromise;
    const callback = new URL(url.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', 'approved-code');
    callback.searchParams.set('state', 'wrong');
    expect((await fetch(callback)).status).toBe(400);
    expect(f.exchanges()).toBe(0);
    callback.searchParams.set('state', url.searchParams.get('state')!);
    expect((await fetch(callback)).status).toBe(200);
    await pending;
    expect(f.exchanges()).toBe(1);
    expect(
      JSON.parse(readFileSync(join(f.root, 'operator.json'), 'utf8')),
    ).toEqual({ issuer: f.config.issuer, subject: 'human', teams: [] });
    expect(f.oauth.operatorConfigured()).toBe(true);
    const restarted = new OperatorOAuth(f.config, f.root, () => undefined);
    expect(restarted.operatorConfigured()).toBe(true);
  });
  it('persists team choices from the verified native grant and reloads them', async () => {
    const claims: Record<string, unknown> = {};
    const f = await fixture(undefined, claims);
    const teams = [
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        name: 'Research',
      },
    ];
    claims.ext = {
      'moltnet:identity_id': 'human',
      'moltnet:subject_type': 'human',
      'moltnet:instance': f.oauth.instance,
      'moltnet:operator_teams': teams,
    };
    const pending = f.oauth.authorize();
    const url = await f.openedPromise;
    const callback = new URL(url.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', url.searchParams.get('state')!);
    callback.searchParams.set('code', 'approved-code');
    await fetch(callback);
    await pending;
    expect(f.oauth.listTeams()).toEqual(teams);
    expect(new OperatorOAuth(f.config, f.root).listTeams()).toEqual(teams);
    expect(readFileSync(join(f.root, 'operator.json'), 'utf8')).not.toContain(
      'access_token',
    );
  });
  it.each([
    { agentId: 'other-agent' },
    { teamId: 'other-team' },
    { operation: 'renew' },
    { idempotencyKey: 'other-request' },
    { scopes: ['task:write'] },
    { scopes: 'task:read' },
    { scopes: [null] },
  ])('rejects an exchanged grant with a changed target: %j', async (change) => {
    const grant: NativeProvisioning = {
      agentId: 'agent',
      teamId: 'team',
      operation: 'enroll',
      scopes: ['task:read'],
      idempotencyKey: 'request',
    };
    const claims: Record<string, unknown> = {};
    const f = await fixture(undefined, claims);
    Object.assign(claims, {
      scp: [OPERATOR_OAUTH.provisioningScope],
      aud: OPERATOR_OAUTH.provisioningAudience,
      ext: {
        'moltnet:identity_id': 'human',
        'moltnet:subject_type': 'human',
        'moltnet:instance': f.oauth.instance,
        'moltnet:provisioning': { ...grant, ...change },
      },
    });
    const pending = f.oauth.authorize(grant);
    const rejection = expect(pending).rejects.toThrow(
      'Approval target differs',
    );
    const url = await f.openedPromise;
    const callback = new URL(url.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', url.searchParams.get('state')!);
    callback.searchParams.set('code', 'approved-code');
    await fetch(callback);
    await rejection;
    expect(f.exchanges()).toBe(1);
    expect(existsSync(join(f.root, 'operator.json'))).toBe(false);
  });

  it.each(['human', 'other-human'])(
    're-reads a concurrent operator pin for %s',
    async (subject) => {
      const f = await fixture();
      const pending = f.oauth.authorize();
      const settled = pending.then(
        () => 'authorized',
        () => 'rejected',
      );
      const url = await f.openedPromise;
      writeFileSync(
        join(f.root, 'operator.json'),
        JSON.stringify({ issuer: f.config.issuer, subject }),
        { mode: 0o600 },
      );
      const callback = new URL(url.searchParams.get('redirect_uri')!);
      callback.searchParams.set('code', 'approved-code');
      callback.searchParams.set('state', url.searchParams.get('state')!);
      await fetch(callback);
      expect(await settled).toBe(
        subject === 'human' ? 'authorized' : 'rejected',
      );
      expect(f.oauth.operatorConfigured()).toBe(subject === 'human');
      expect(
        JSON.parse(readFileSync(join(f.root, 'operator.json'), 'utf8')),
      ).toMatchObject({ subject });
    },
  );
  it.each(['cancel', 'removeOperator'] as const)(
    'honors %s during signing-key retrieval',
    async (action) => {
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const f = await fixture(async () => {
        entered();
        await blocked;
      });
      const pending = f.oauth.authorize();
      const rejection = expect(pending).rejects.toThrow();
      const url = await f.openedPromise;
      const callback = new URL(url.searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', url.searchParams.get('state')!);
      callback.searchParams.set('code', 'approved-code');
      await fetch(callback);
      await started;
      f.oauth[action]();
      release();
      await rejection;
      expect(f.oauth.operatorConfigured()).toBe(false);
      expect(existsSync(join(f.root, 'operator.json'))).toBe(false);
      expect(f.exchanges()).toBe(1);
    },
  );
  it('cancels without exchanging or replacing the stored operator', async () => {
    const f = await fixture();
    const pending = f.oauth.authorize();
    const rejection = expect(pending).rejects.toThrow('cancelled');
    await f.openedPromise;
    f.oauth.cancel();
    await rejection;
    expect(f.exchanges()).toBe(0);
    expect(f.oauth.operatorConfigured()).toBe(false);
  });
});
