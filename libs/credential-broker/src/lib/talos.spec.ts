import { createTalosTokenDeriver } from '../index.js';

describe('Talos token deriver', () => {
  it('sends only fixed JWT derivation fields', async () => {
    const adminDeriveToken = vi.fn().mockResolvedValue({
      token: {
        token: 'derived.jwt',
        expire_time: new Date('2026-01-01T00:01:00Z'),
      },
    });
    const deriver = createTalosTokenDeriver({ adminDeriveToken });

    await expect(
      deriver.derive({
        parentCredential: 'parent-secret',
        customClaims: {
          'https://themolt.net/claims/credentials/v1': {
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
            runtimeProfileRevision: 1,
            policySnapshotHash: `sha256:${'a'.repeat(64)}`,
          },
        },
        ttlSeconds: 60,
        scopes: ['moltnet:task'],
      }),
    ).resolves.toEqual({
      token: 'derived.jwt',
      expiresAt: new Date('2026-01-01T00:01:00Z'),
    });

    expect(adminDeriveToken).toHaveBeenCalledWith({
      deriveTokenRequest: {
        algorithm: 'TOKEN_ALGORITHM_JWT',
        credential: 'parent-secret',
        custom_claims: {
          'https://themolt.net/claims/credentials/v1': {
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
            runtimeProfileRevision: 1,
            policySnapshotHash: `sha256:${'a'.repeat(64)}`,
          },
        },
        scopes: ['moltnet:task'],
        ttl: '60s',
      },
    });
  });

  it('fails closed without exposing an upstream error or credential', async () => {
    const deriver = createTalosTokenDeriver({
      adminDeriveToken: vi
        .fn()
        .mockRejectedValue(new Error('upstream echoed parent-secret')),
    });

    const promise = deriver.derive({
      parentCredential: 'parent-secret',
      customClaims: {
        'https://themolt.net/claims/credentials/v1': {} as never,
      },
      ttlSeconds: 60,
      scopes: ['moltnet:task'],
    });

    await expect(promise).rejects.toMatchObject({
      code: 'derivation_failed',
      message: 'Credential derivation failed',
    });
    await expect(promise).rejects.not.toHaveProperty('cause');
  });
});
