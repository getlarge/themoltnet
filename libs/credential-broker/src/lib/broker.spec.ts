import type {
  TaskCredentialClaims,
  VerifiedCredential,
} from '@themoltnet/credentials';

import { createCredentialBroker, type TokenDeriver } from '../index.js';

const taskClaims: TaskCredentialClaims = {
  version: 1,
  kind: 'task',
  agentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  teamId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  attemptN: 1,
  leaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  runtimeKind: 'pi',
  capabilityManifestVersion: 'pi-v1',
  runtimeProfileId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  runtimeProfileRevision: 3,
  policySnapshotHash: `sha256:${'a'.repeat(64)}`,
};

const verifiedTask: VerifiedCredential<TaskCredentialClaims> = {
  claims: taskClaims,
  issuer: 'https://issuer.example',
  subject: taskClaims.agentId,
  issuedAt: new Date('2025-12-31T23:59:00Z'),
  expiresAt: new Date('2026-01-01T00:02:00Z'),
  jti: 'parent-jti',
  protectedHeader: { alg: 'EdDSA', kid: 'key' },
};

const taskBinding = {
  agentId: taskClaims.agentId,
  teamId: taskClaims.teamId,
  taskId: taskClaims.taskId,
  attemptN: taskClaims.attemptN,
};

describe('credential broker', () => {
  it('constructs canonical task claims and caps TTL at the lease', async () => {
    const derive = vi.fn<TokenDeriver['derive']>().mockResolvedValue({
      token: 'derived.jwt',
      expiresAt: new Date('2026-01-01T00:01:30Z'),
    });
    const authorizeTask = vi.fn().mockResolvedValue({
      allowed: true,
      reason: 'active_lease',
      leaseExpiresAt: new Date('2026-01-01T00:01:30Z'),
      claims: {
        ...taskClaims,
        version: undefined,
        kind: undefined,
      },
    });
    const broker = createCredentialBroker({
      clock: { now: () => new Date('2026-01-01T00:00:00Z') },
      taskTtlCeilingSeconds: 300,
      tokenDeriver: { derive },
      taskAuthority: { authorizeTask },
    });

    await broker.issueTaskCredential({
      agentCredential: 'parent-secret',
      agentId: taskClaims.agentId,
      teamId: taskClaims.teamId,
      taskId: taskClaims.taskId,
      attemptN: 1,
    });

    expect(derive).toHaveBeenCalledWith(
      expect.objectContaining({
        parentCredential: 'parent-secret',
        ttlSeconds: 90,
        scopes: ['moltnet:task'],
      }),
    );
    expect(authorizeTask).toHaveBeenCalledWith({
      agentId: taskClaims.agentId,
      teamId: taskClaims.teamId,
      taskId: taskClaims.taskId,
      attemptN: 1,
    });
    expect(authorizeTask.mock.calls[0]?.[0]).not.toHaveProperty(
      'agentCredential',
    );
    const customClaims = derive.mock.calls[0]?.[0].customClaims;
    expect(customClaims).toEqual({
      'https://themolt.net/claims/credentials/v1': taskClaims,
    });
  });

  it('rejects a task-authority decision bound to a different claimant', async () => {
    const derive = vi.fn<TokenDeriver['derive']>();
    const broker = createCredentialBroker({
      tokenDeriver: { derive },
      taskAuthority: {
        authorizeTask: vi.fn().mockResolvedValue({
          allowed: true,
          reason: 'active_lease',
          leaseExpiresAt: new Date(Date.now() + 60_000),
          claims: {
            ...taskClaims,
            agentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          },
        }),
      },
    });

    await expect(
      broker.issueTaskCredential({
        agentCredential: 'parent-secret',
        ...taskBinding,
      }),
    ).rejects.toMatchObject({
      code: 'authority_denied',
      message: 'Task authority returned an invalid decision',
    });
    expect(derive).not.toHaveBeenCalled();
  });

  it('converts provider failures to secret-safe errors and evidence', async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const broker = createCredentialBroker({
      tokenDeriver: { derive: vi.fn() },
      evidence: { emit },
      taskAuthority: {
        authorizeTask: vi
          .fn()
          .mockRejectedValue(new Error('database echoed parent-secret')),
      },
    });

    const promise = broker.issueTaskCredential({
      agentCredential: 'parent-secret',
      ...taskBinding,
    });

    await expect(promise).rejects.toMatchObject({
      code: 'authority_unavailable',
      message: 'Task authority is unavailable',
    });
    expect(JSON.stringify(emit.mock.calls)).not.toContain('parent-secret');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'authority_unavailable' }),
    );
  });

  it('prevents a connector provider from injecting claims or widening TTL', async () => {
    const derive = vi.fn<TokenDeriver['derive']>().mockResolvedValue({
      token: 'connector.jwt',
      expiresAt: new Date('2026-01-01T00:01:00Z'),
    });
    const verify = vi.fn().mockResolvedValue(verifiedTask);
    const broker = createCredentialBroker({
      clock: { now: () => new Date('2026-01-01T00:00:00Z') },
      connectorTtlCeilingSeconds: 300,
      tokenDeriver: { derive },
      taskCredentialVerifier: { verify },
      connectorAuthority: {
        authorizeConnector: vi.fn().mockResolvedValue({
          allowed: true,
          reason: 'grant_active',
          grantRevision: 4,
          authorityExpiresAt: new Date('2026-01-01T00:01:00Z'),
          injectedClaim: 'impossible-at-type-boundary',
        }),
      },
    });

    const issued = await broker.issueConnectorCredential({
      taskCredential: 'task.jwt',
      task: taskBinding,
      grantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      connectorId: 'plant-readonly',
      operation: 'read',
      resourceId: 'sensor-17',
    });

    expect(issued.binding).not.toHaveProperty('injectedClaim');
    expect(verify).toHaveBeenCalledWith('task.jwt', taskBinding);
    expect(derive).toHaveBeenCalledWith({
      parentCredential: 'task.jwt',
      customClaims: {
        'https://themolt.net/claims/credentials/v1': issued.binding,
      },
      ttlSeconds: 60,
      scopes: ['moltnet:connector'],
    });
  });

  it('does not copy an unsafe authority reason into evidence', async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const broker = createCredentialBroker({
      tokenDeriver: { derive: vi.fn() },
      evidence: { emit },
      taskAuthority: {
        authorizeTask: vi.fn().mockResolvedValue({
          allowed: false,
          reason: 'denied: parent-secret leaked!',
        }),
      },
    });

    await expect(
      broker.issueTaskCredential({
        agentCredential: 'parent-secret',
        ...taskBinding,
      }),
    ).rejects.toMatchObject({ code: 'authority_denied' });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'authority_denied' }),
    );
    expect(JSON.stringify(emit.mock.calls)).not.toContain('parent-secret');
  });

  it('verifies the task credential before consulting connector authority', async () => {
    const authorizeConnector = vi.fn();
    const derive = vi.fn<TokenDeriver['derive']>();
    const broker = createCredentialBroker({
      tokenDeriver: { derive },
      taskCredentialVerifier: {
        verify: vi.fn().mockRejectedValue(new Error('task.jwt echoed')),
      },
      connectorAuthority: { authorizeConnector },
    });

    await expect(
      broker.issueConnectorCredential({
        taskCredential: 'task.jwt',
        task: taskBinding,
        grantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        connectorId: 'plant-readonly',
        operation: 'read',
        resourceId: 'sensor-17',
      }),
    ).rejects.toMatchObject({
      code: 'credential_invalid',
      message: 'Task credential verification failed',
    });
    expect(authorizeConnector).not.toHaveBeenCalled();
    expect(derive).not.toHaveBeenCalled();
  });
});
