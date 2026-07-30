import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createLocalJWKSet } from 'jose/jwks/local';

import {
  CREDENTIAL_CLAIM_NAMESPACE,
  CredentialError,
  verifyConnectorCredential,
  verifyTaskCredential,
} from '../index.js';

const ids = {
  agentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  teamId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  leaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  profileId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  grantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
};

const taskClaims = (attemptN = 2) => ({
  version: 1 as const,
  kind: 'task' as const,
  agentId: ids.agentId,
  teamId: ids.teamId,
  taskId: ids.taskId,
  attemptN,
  leaseId: ids.leaseId,
  runtimeKind: 'pi',
  executorManifestFingerprint: 'bafkreiexecutor',
  runtimeProfileId: ids.profileId,
  runtimeProfileRevision: 7,
  policySnapshotHash: `sha256:${'a'.repeat(64)}`,
});

const connectorClaims = {
  version: 1 as const,
  kind: 'connector' as const,
  task: {
    agentId: ids.agentId,
    teamId: ids.teamId,
    taskId: ids.taskId,
    attemptN: 2,
    leaseId: ids.leaseId,
  },
  grantId: ids.grantId,
  grantRevision: 4,
  connectorId: 'plant-readonly',
  operation: 'read',
  resourceId: 'sensor-17',
  parentTaskJti: 'parent-task-jti',
};

async function fixture(options?: {
  claims?: object;
  subject?: string;
  issuer?: string;
  audience?: string | string[];
  expiresInSeconds?: number;
  includeKid?: boolean;
  algorithm?: 'EdDSA' | 'ES256';
}) {
  const algorithm = options?.algorithm ?? 'EdDSA';
  const { publicKey, privateKey } = await generateKeyPair(
    algorithm === 'EdDSA' ? 'Ed25519' : algorithm,
  );
  const publicJwk = await exportJWK(publicKey);
  const now = Math.floor(Date.now() / 1_000);
  const signer = new SignJWT({
    [CREDENTIAL_CLAIM_NAMESPACE]: options?.claims ?? taskClaims(),
  })
    .setProtectedHeader({
      alg: algorithm,
      ...(options?.includeKid === false ? {} : { kid: 'test-key' }),
    })
    .setIssuer(options?.issuer ?? 'https://issuer.example')
    .setSubject(options?.subject ?? ids.agentId)
    .setIssuedAt(now)
    .setExpirationTime(now + (options?.expiresInSeconds ?? 60))
    .setJti('task-jti');
  if (options?.audience !== undefined) signer.setAudience(options.audience);
  const token = await signer.sign(privateKey);
  return {
    token,
    keyResolver: createLocalJWKSet({
      keys: [{ ...publicJwk, kid: 'test-key', alg: algorithm }],
    }),
  };
}

function tamperSignature(token: string): string {
  const sections = token.split('.');
  const signature = sections[2];
  if (!signature) throw new Error('Fixture did not produce a JWT signature');
  sections[2] = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  return sections.join('.');
}

describe('task credential verification', () => {
  it('verifies signature, issuer, kind, expiry, and exact bindings', async () => {
    const { token, keyResolver } = await fixture();
    const verified = await verifyTaskCredential(token, {
      issuer: 'https://issuer.example',
      keyResolver,
      expected: {
        agentId: ids.agentId,
        teamId: ids.teamId,
        taskId: ids.taskId,
        attemptN: 2,
        leaseId: ids.leaseId,
        runtimeKind: 'pi',
        executorManifestFingerprint: 'bafkreiexecutor',
        runtimeProfileId: ids.profileId,
        runtimeProfileRevision: 7,
        policySnapshotHash: `sha256:${'a'.repeat(64)}`,
      },
    });
    expect(verified.claims.kind).toBe('task');
    expect(verified.jti).toBe('task-jti');
  });

  it('fails closed when an exact binding differs', async () => {
    const { token, keyResolver } = await fixture({ claims: taskClaims(1) });
    await expect(
      verifyTaskCredential(token, {
        issuer: 'https://issuer.example',
        keyResolver,
        expected: { attemptN: 2 },
      }),
    ).rejects.toMatchObject({
      code: 'credential_binding_mismatch',
    });
  });

  it('verifies a standard audience when the relying party expects one', async () => {
    const { token, keyResolver } = await fixture({
      audience: ['https://api.themolt.net', 'https://fixture.example'],
    });
    const verified = await verifyTaskCredential(token, {
      issuer: 'https://issuer.example',
      audience: 'https://fixture.example',
      keyResolver,
      expected: { agentId: ids.agentId },
    });
    expect(verified.claims.kind).toBe('task');
  });

  it.each([
    { name: 'a different audience', audience: 'https://other.example' },
    { name: 'no audience at all', audience: undefined },
  ])(
    'rejects a credential minted for $name when one is expected',
    async ({ audience }) => {
      const { token, keyResolver } = await fixture({ audience });
      await expect(
        verifyTaskCredential(token, {
          issuer: 'https://issuer.example',
          audience: 'https://fixture.example',
          keyResolver,
          expected: {},
        }),
      ).rejects.toMatchObject({ code: 'credential_invalid' });
    },
  );

  it('rejects a standard subject that differs from the namespaced agent', async () => {
    const { token, keyResolver } = await fixture({
      subject: ids.grantId,
    });
    await expect(
      verifyTaskCredential(token, {
        issuer: 'https://issuer.example',
        keyResolver,
        expected: {},
      }),
    ).rejects.toMatchObject({
      code: 'credential_binding_mismatch',
    });
  });

  it.each([
    {
      name: 'non-EdDSA algorithm',
      createToken: async () => fixture({ algorithm: 'ES256' }),
      code: 'credential_invalid',
    },
    {
      name: 'tampered signature',
      createToken: async () => {
        const value = await fixture();
        return { ...value, token: tamperSignature(value.token) };
      },
      code: 'credential_signature_invalid',
    },
    {
      name: 'unsigned alg:none token',
      createToken: async () => {
        const value = await fixture();
        const header = Buffer.from(
          JSON.stringify({ alg: 'none', kid: 'test-key' }),
        ).toString('base64url');
        const payload = Buffer.from(
          JSON.stringify({
            iss: 'https://issuer.example',
            sub: ids.agentId,
            iat: Math.floor(Date.now() / 1_000),
            exp: Math.floor(Date.now() / 1_000) + 60,
            jti: 'unsigned-jti',
            [CREDENTIAL_CLAIM_NAMESPACE]: taskClaims(),
          }),
        ).toString('base64url');
        return { ...value, token: `${header}.${payload}.` };
      },
      code: 'credential_invalid',
    },
  ])('rejects $name', async ({ createToken, code }) => {
    const { token, keyResolver } = await createToken();
    await expect(
      verifyTaskCredential(token, {
        issuer: 'https://issuer.example',
        keyResolver,
        expected: {},
      }),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    {
      name: 'wrong issuer',
      fixtureOptions: {},
      issuer: 'https://wrong.example',
      code: 'credential_invalid',
    },
    {
      name: 'expired token',
      fixtureOptions: { expiresInSeconds: -10 },
      issuer: 'https://issuer.example',
      code: 'credential_expired',
    },
    {
      name: 'missing key id',
      fixtureOptions: { includeKid: false },
      issuer: 'https://issuer.example',
      code: 'credential_invalid',
    },
  ])('rejects $name', async ({ fixtureOptions, issuer, code }) => {
    const { token, keyResolver } = await fixture(fixtureOptions);
    await expect(
      verifyTaskCredential(token, {
        issuer,
        keyResolver,
        expected: {},
      }),
    ).rejects.toMatchObject({ code });
  });

  it('rejects a valid task token when a connector token is required', async () => {
    const { token, keyResolver } = await fixture();
    await expect(
      verifyConnectorCredential(token, {
        issuer: 'https://issuer.example',
        keyResolver,
        expected: {},
      }),
    ).rejects.toMatchObject({ code: 'credential_invalid' });
  });

  it('verifies every connector and parent-lineage binding', async () => {
    const { token, keyResolver } = await fixture({ claims: connectorClaims });

    await expect(
      verifyConnectorCredential(token, {
        issuer: 'https://issuer.example',
        keyResolver,
        expected: {
          agentId: ids.agentId,
          teamId: ids.teamId,
          taskId: ids.taskId,
          attemptN: 2,
          leaseId: ids.leaseId,
          connectorId: 'plant-readonly',
          operation: 'read',
          resourceId: 'sensor-17',
          grantId: ids.grantId,
          grantRevision: 4,
          parentTaskJti: 'parent-task-jti',
        },
      }),
    ).resolves.toMatchObject({ claims: connectorClaims });
  });

  it.each([
    ['agent', { agentId: ids.grantId }],
    ['team', { teamId: ids.grantId }],
    ['task', { taskId: ids.grantId }],
    ['attempt', { attemptN: 3 }],
    ['lease', { leaseId: ids.grantId }],
    ['connector', { connectorId: 'other-connector' }],
    ['operation', { operation: 'write' }],
    ['resource', { resourceId: 'sensor-18' }],
    ['grant', { grantId: ids.profileId }],
    ['grant revision', { grantRevision: 5 }],
    ['parent lineage', { parentTaskJti: 'other-parent-jti' }],
  ])('rejects a mismatched connector %s binding', async (_name, expected) => {
    const { token, keyResolver } = await fixture({ claims: connectorClaims });
    await expect(
      verifyConnectorCredential(token, {
        issuer: 'https://issuer.example',
        keyResolver,
        expected,
      }),
    ).rejects.toMatchObject({ code: 'credential_binding_mismatch' });
  });

  it('returns secret-safe verification errors without retained causes', async () => {
    const { token } = await fixture();
    const error = await verifyTaskCredential(token, {
      issuer: 'https://issuer.example',
      keyResolver: () =>
        Promise.reject(new Error('resolver echoed parent-secret')),
      expected: {},
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CredentialError);
    expect(error).not.toHaveProperty('cause');
    expect(error).toMatchObject({
      code: 'credential_verification_unavailable',
    });
    expect(JSON.stringify(error)).not.toContain('parent-secret');
  });
});
