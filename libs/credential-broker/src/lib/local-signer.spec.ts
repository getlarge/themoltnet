import {
  type ConnectorCredentialClaims,
  CREDENTIAL_CLAIM_NAMESPACE,
  type TaskCredentialClaims,
  verifyTaskCredential,
} from '@themoltnet/credentials';
import { createLocalJWKSet, decodeJwt, decodeProtectedHeader } from 'jose';

import {
  createLocalTokenDeriver,
  credentialSigningJwks,
  generateLocalSigningKeyJwk,
  importLocalSigningKey,
  type LocalSigningKey,
} from '../index.js';

const ISSUER = 'https://api.themolt.net';
const AUDIENCE = 'https://api.themolt.net';
const PARENT_CREDENTIAL = 'ory_ak_parent-secret';

const taskClaims: TaskCredentialClaims = {
  version: 1,
  kind: 'task',
  agentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  teamId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  attemptN: 1,
  leaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  runtimeKind: 'pi',
  executorManifestFingerprint: 'bafkreiexecutor',
  runtimeProfileId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  runtimeProfileRevision: 1,
  policySnapshotHash: `sha256:${'a'.repeat(64)}`,
};

const connectorClaims: ConnectorCredentialClaims = {
  version: 1,
  kind: 'connector',
  task: {
    agentId: taskClaims.agentId,
    teamId: taskClaims.teamId,
    taskId: taskClaims.taskId,
    attemptN: taskClaims.attemptN,
    leaseId: taskClaims.leaseId,
  },
  grantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  grantRevision: 3,
  connectorId: 'github',
  operation: 'issues.comment',
  resourceId: 'getlarge/themoltnet',
  parentTaskJti: 'task-jti-1',
};

function taskInput(overrides: { ttlSeconds?: number } = {}) {
  return {
    parentCredential: PARENT_CREDENTIAL,
    customClaims: { [CREDENTIAL_CLAIM_NAMESPACE]: taskClaims },
    ttlSeconds: overrides.ttlSeconds ?? 300,
    scopes: ['moltnet:task'] as const,
  };
}

async function signingKey(kid: string): Promise<LocalSigningKey> {
  return importLocalSigningKey(generateLocalSigningKeyJwk(kid));
}

describe('local token deriver', () => {
  it('mints a task credential the shipped verifier accepts', async () => {
    const key = await signingKey('active-key');
    const deriver = createLocalTokenDeriver({
      issuer: ISSUER,
      audience: AUDIENCE,
      signingKey: key,
    });

    const derived = await deriver.derive(taskInput());

    const verified = await verifyTaskCredential(derived.token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      keyResolver: createLocalJWKSet(credentialSigningJwks([key])),
      expected: {
        agentId: taskClaims.agentId,
        teamId: taskClaims.teamId,
        taskId: taskClaims.taskId,
        attemptN: taskClaims.attemptN,
        leaseId: taskClaims.leaseId,
        runtimeKind: taskClaims.runtimeKind,
        executorManifestFingerprint: taskClaims.executorManifestFingerprint,
        runtimeProfileId: taskClaims.runtimeProfileId,
        runtimeProfileRevision: taskClaims.runtimeProfileRevision,
        policySnapshotHash: taskClaims.policySnapshotHash,
      },
    });

    expect(verified.claims).toEqual(taskClaims);
    expect(verified.subject).toBe(taskClaims.agentId);
    expect(verified.issuer).toBe(ISSUER);
    expect(verified.jti).toBe(derived.jti);
    expect(verified.protectedHeader).toEqual({
      alg: 'EdDSA',
      kid: 'active-key',
    });
  });

  it('rejects a credential minted for another relying-party audience', async () => {
    const key = await signingKey('active-key');
    const deriver = createLocalTokenDeriver({
      issuer: ISSUER,
      audience: 'https://fixture.external.test',
      signingKey: key,
    });

    const derived = await deriver.derive(taskInput());

    await expect(
      verifyTaskCredential(derived.token, {
        issuer: ISSUER,
        audience: AUDIENCE,
        keyResolver: createLocalJWKSet(credentialSigningJwks([key])),
        expected: { agentId: taskClaims.agentId },
      }),
    ).rejects.toMatchObject({ code: 'credential_invalid' });
  });

  it('floors the issue time and bounds expiry to the requested lifetime', async () => {
    const key = await signingKey('active-key');
    const deriver = createLocalTokenDeriver({
      issuer: ISSUER,
      audience: AUDIENCE,
      signingKey: key,
      clock: { now: () => new Date('2026-01-01T00:00:00.750Z') },
      generateJti: () => 'jti-1',
    });

    const derived = await deriver.derive(taskInput({ ttlSeconds: 60 }));

    const issuedAt = Math.floor(
      new Date('2026-01-01T00:00:00.000Z').getTime() / 1_000,
    );
    expect(decodeJwt(derived.token)).toMatchObject({
      iat: issuedAt,
      nbf: issuedAt,
      exp: issuedAt + 60,
    });
    expect(derived).toMatchObject({
      expiresAt: new Date('2026-01-01T00:01:00.000Z'),
      jti: 'jti-1',
      kid: 'active-key',
    });
  });

  it('mints MoltNet-owned reserved claims plus the namespaced claim', async () => {
    const key = await signingKey('active-key');
    const deriver = createLocalTokenDeriver({
      issuer: ISSUER,
      audience: [AUDIENCE, 'https://fixture.external.test'],
      signingKey: key,
      generateJti: () => 'jti-1',
    });

    const derived = await deriver.derive(taskInput());

    expect(decodeJwt(derived.token)).toMatchObject({
      iss: ISSUER,
      sub: taskClaims.agentId,
      aud: [AUDIENCE, 'https://fixture.external.test'],
      jti: 'jti-1',
      scope: 'moltnet:task',
      [CREDENTIAL_CLAIM_NAMESPACE]: taskClaims,
    });
    expect(decodeProtectedHeader(derived.token)).toEqual({
      alg: 'EdDSA',
      kid: 'active-key',
      typ: 'JWT',
    });
  });

  it('never embeds the parent credential', async () => {
    const key = await signingKey('active-key');
    const deriver = createLocalTokenDeriver({
      issuer: ISSUER,
      audience: AUDIENCE,
      signingKey: key,
    });

    const derived = await deriver.derive(taskInput());

    expect(JSON.stringify(decodeJwt(derived.token))).not.toContain(
      PARENT_CREDENTIAL,
    );
    expect(Buffer.from(derived.token, 'base64').toString('utf8')).not.toContain(
      PARENT_CREDENTIAL,
    );
  });

  it('signs connector claims for the originating task subject', async () => {
    const key = await signingKey('active-key');
    const deriver = createLocalTokenDeriver({
      issuer: ISSUER,
      audience: AUDIENCE,
      signingKey: key,
    });

    const derived = await deriver.derive({
      parentCredential: 'task.jwt',
      customClaims: { [CREDENTIAL_CLAIM_NAMESPACE]: connectorClaims },
      ttlSeconds: 300,
      scopes: ['moltnet:connector'],
    });

    expect(decodeJwt(derived.token)).toMatchObject({
      sub: connectorClaims.task.agentId,
      scope: 'moltnet:connector',
      [CREDENTIAL_CLAIM_NAMESPACE]: connectorClaims,
    });
  });

  it.each([
    { name: 'an empty claim object', claims: {} },
    {
      name: 'an unknown credential kind',
      claims: { ...taskClaims, kind: 'x' },
    },
    {
      name: 'an unexpected extra claim',
      claims: { ...taskClaims, ttl: 999 },
    },
    {
      name: 'a mistyped attempt number',
      claims: { ...taskClaims, attemptN: '1' },
    },
  ])('refuses to sign $name', async ({ claims }) => {
    const key = await signingKey('active-key');
    const deriver = createLocalTokenDeriver({
      issuer: ISSUER,
      audience: AUDIENCE,
      signingKey: key,
    });

    await expect(
      deriver.derive({
        parentCredential: PARENT_CREDENTIAL,
        customClaims: { [CREDENTIAL_CLAIM_NAMESPACE]: claims as never },
        ttlSeconds: 300,
        scopes: ['moltnet:task'],
      }),
    ).rejects.toMatchObject({
      code: 'derivation_failed',
      message: 'Credential derivation received non-canonical claims',
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])(
    'refuses an invalid lifetime of %s',
    async (ttlSeconds) => {
      const key = await signingKey('active-key');
      const deriver = createLocalTokenDeriver({
        issuer: ISSUER,
        audience: AUDIENCE,
        signingKey: key,
      });

      await expect(
        deriver.derive(taskInput({ ttlSeconds })),
      ).rejects.toMatchObject({
        code: 'derivation_failed',
        message: 'Credential derivation received an invalid lifetime',
      });
    },
  );

  it('fails closed without a cause when signing fails', async () => {
    const key = await signingKey('active-key');
    const deriver = createLocalTokenDeriver({
      issuer: ISSUER,
      audience: AUDIENCE,
      signingKey: { ...key, privateKey: {} as CryptoKey },
    });

    const promise = deriver.derive(taskInput());

    await expect(promise).rejects.toMatchObject({
      code: 'derivation_failed',
      message: 'Credential derivation failed',
    });
    await expect(promise).rejects.not.toHaveProperty('cause');
  });

  it('rejects an empty issuer or audience at construction', async () => {
    const key = await signingKey('active-key');

    expect(() =>
      createLocalTokenDeriver({
        issuer: '  ',
        audience: AUDIENCE,
        signingKey: key,
      }),
    ).toThrow('Credential issuer must not be empty');
    expect(() =>
      createLocalTokenDeriver({
        issuer: ISSUER,
        audience: [],
        signingKey: key,
      }),
    ).toThrow('Credential audience must contain at least one value');
  });
});

describe('local signing key material', () => {
  it('imports a generated key from its object or JSON form', async () => {
    const jwk = generateLocalSigningKeyJwk('active-key');

    const fromObject = await importLocalSigningKey(jwk);
    const fromJson = await importLocalSigningKey(JSON.stringify(jwk));

    expect(fromObject.kid).toBe('active-key');
    expect(fromObject.publicJwk).toEqual(fromJson.publicJwk);
    expect(fromObject.publicJwk).toEqual({
      kty: 'OKP',
      crv: 'Ed25519',
      x: jwk.x,
      kid: 'active-key',
      alg: 'EdDSA',
      use: 'sig',
    });
  });

  it.each([
    { name: 'invalid JSON', source: '{', detail: 'not valid JSON' },
    { name: 'a non-object', source: 42, detail: 'not a JSON object' },
    { name: 'an RSA key', source: { kty: 'RSA' }, detail: 'unsupported "kty"' },
    {
      name: 'a P-256 key',
      source: { kty: 'OKP', crv: 'P-256' },
      detail: 'unsupported "crv"',
    },
    {
      name: 'a public-only key',
      source: { kty: 'OKP', crv: 'Ed25519', x: 'pub', kid: 'k' },
      detail: 'missing "d"',
    },
    {
      name: 'a key without an identifier',
      source: { kty: 'OKP', crv: 'Ed25519', x: 'pub', d: 'priv' },
      detail: 'missing "kid"',
    },
    {
      name: 'a key with an unusable identifier',
      source: { kty: 'OKP', crv: 'Ed25519', x: 'pub', d: 'priv', kid: '#bad' },
      detail: 'unsupported "kid" shape',
    },
  ])('rejects $name', async ({ source, detail }) => {
    await expect(importLocalSigningKey(source)).rejects.toThrow(detail);
  });

  it('rejects unusable key material without echoing it', async () => {
    const jwk = generateLocalSigningKeyJwk('active-key');
    const corrupted = { ...jwk, d: 'not-a-key' };

    const promise = importLocalSigningKey(corrupted);

    await expect(promise).rejects.toThrow('not importable as an EdDSA key');
    await expect(promise).rejects.not.toHaveProperty(
      'message',
      expect.stringContaining('not-a-key'),
    );
  });

  it('publishes public material only, and keeps a retiring key verifiable', async () => {
    const retiring = await signingKey('retiring-key');
    const active = await signingKey('active-key');

    const jwks = credentialSigningJwks([active, retiring, active]);

    expect(jwks.keys.map((key) => key.kid)).toEqual([
      'active-key',
      'retiring-key',
    ]);
    expect(JSON.stringify(jwks)).not.toContain('"d"');

    // A credential signed by the elder key stays verifiable while the newer key
    // signs everything issued from now on.
    const derived = await createLocalTokenDeriver({
      issuer: ISSUER,
      audience: AUDIENCE,
      signingKey: retiring,
    }).derive(taskInput());

    await expect(
      verifyTaskCredential(derived.token, {
        issuer: ISSUER,
        audience: AUDIENCE,
        keyResolver: createLocalJWKSet(jwks),
        expected: { agentId: taskClaims.agentId },
      }),
    ).resolves.toMatchObject({ claims: taskClaims });
  });
});
