import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createLocalJWKSet } from 'jose/jwks/local';

import {
  CREDENTIAL_CLAIM_NAMESPACE,
  CredentialError,
  parseCredentialPayload,
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
  capabilityManifestVersion: 'pi-v1',
  runtimeProfileId: ids.profileId,
  runtimeProfileRevision: 7,
  policySnapshotHash: `sha256:${'a'.repeat(64)}`,
});

async function fixture(options?: {
  claims?: object;
  subject?: string;
  issuer?: string;
  expiresInSeconds?: number;
  includeKid?: boolean;
}) {
  const { publicKey, privateKey } = await generateKeyPair('Ed25519');
  const publicJwk = await exportJWK(publicKey);
  const now = Math.floor(Date.now() / 1_000);
  const token = await new SignJWT({
    [CREDENTIAL_CLAIM_NAMESPACE]: options?.claims ?? taskClaims(),
  })
    .setProtectedHeader({
      alg: 'EdDSA',
      ...(options?.includeKid === false ? {} : { kid: 'test-key' }),
    })
    .setIssuer(options?.issuer ?? 'https://issuer.example')
    .setSubject(options?.subject ?? ids.agentId)
    .setIssuedAt(now)
    .setExpirationTime(now + (options?.expiresInSeconds ?? 60))
    .setJti('task-jti')
    .sign(privateKey);
  return {
    token,
    keyResolver: createLocalJWKSet({
      keys: [{ ...publicJwk, kid: 'test-key', alg: 'EdDSA' }],
    }),
  };
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
        capabilityManifestVersion: 'pi-v1',
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
    const connectorClaims = {
      version: 1,
      kind: 'connector',
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

  it('returns secret-safe verification errors without retained causes', () => {
    const error = (() => {
      try {
        parseCredentialPayload('parent-secret');
      } catch (caught) {
        return caught;
      }
      throw new Error('Expected parsing to fail');
    })();

    expect(error).toBeInstanceOf(CredentialError);
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('parent-secret');
  });
});
