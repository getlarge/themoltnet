import {
  createTalosTokenDeriver,
  type TalosChainedDerivationCapability,
} from '../index.js';

const chainedCapability = {
  mode: 'chained',
  managedParityValidated: true,
  derivedJwtChaining: true,
} as const;

const invalidCapabilities: Array<{
  capability: TalosChainedDerivationCapability;
  name: string;
}> = [
  {
    capability: {
      mode: 'exchange',
      managedParityValidated: true,
      derivedJwtChaining: true,
    },
    name: 'exchange mode',
  },
  {
    capability: {
      mode: 'chained',
      managedParityValidated: false,
      derivedJwtChaining: true,
    },
    name: 'missing managed parity',
  },
  {
    capability: {
      mode: 'chained',
      managedParityValidated: true,
      derivedJwtChaining: false,
    },
    name: 'unsupported JWT chaining',
  },
];

describe('Talos token deriver', () => {
  it('sends only fixed JWT derivation fields', async () => {
    const adminDeriveToken = vi.fn().mockResolvedValue({
      token: {
        token: 'derived.jwt',
        expire_time: new Date('2026-01-01T00:01:00Z'),
      },
    });
    const deriver = createTalosTokenDeriver(
      { adminDeriveToken },
      chainedCapability,
    );

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
            executorManifestFingerprint: 'bafkreiexecutor',
            runtimeProfileId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            runtimeProfileRevision: 1,
            policySnapshotHash: `sha256:${'a'.repeat(64)}`,
          },
        },
        ttlSeconds: 60,
        scopes: ['task:execute'],
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
            executorManifestFingerprint: 'bafkreiexecutor',
            runtimeProfileId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            runtimeProfileRevision: 1,
            policySnapshotHash: `sha256:${'a'.repeat(64)}`,
          },
        },
        scopes: ['task:execute'],
        ttl: '60s',
      },
    });
  });

  it('fails closed without exposing an upstream error or credential', async () => {
    const deriver = createTalosTokenDeriver(
      {
        adminDeriveToken: vi
          .fn()
          .mockRejectedValue(new Error('upstream echoed parent-secret')),
      },
      chainedCapability,
    );

    const promise = deriver.derive({
      parentCredential: 'parent-secret',
      customClaims: {
        'https://themolt.net/claims/credentials/v1': {} as never,
      },
      ttlSeconds: 60,
      scopes: ['task:execute'],
    });

    await expect(promise).rejects.toMatchObject({
      code: 'derivation_failed',
      message: 'Credential derivation failed',
    });
    await expect(promise).rejects.not.toHaveProperty('cause');
  });

  it.each(invalidCapabilities)(
    'rejects $name at the capability gate',
    ({ capability }) => {
      let thrown: unknown;
      try {
        createTalosTokenDeriver({ adminDeriveToken: vi.fn() }, capability);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        code: 'authority_unavailable',
        message: 'Talos chained derivation capability gate is not satisfied',
      });
    },
  );

  it.each([
    {
      error: { status: 401, message: 'credential parent-secret rejected' },
      expectedCode: 'derivation_rejected',
      expectedMessage: 'Credential derivation was rejected',
    },
    {
      error: { status: 503, message: 'service leaked parent-secret' },
      expectedCode: 'derivation_unavailable',
      expectedMessage: 'Credential derivation service is unavailable',
    },
    {
      error: { code: 'ETIMEDOUT', message: 'network leaked parent-secret' },
      expectedCode: 'derivation_unavailable',
      expectedMessage: 'Credential derivation service is unavailable',
    },
  ])(
    'maps an upstream failure to $expectedCode without retaining secrets',
    async ({ error, expectedCode, expectedMessage }) => {
      const deriver = createTalosTokenDeriver(
        {
          adminDeriveToken: vi.fn().mockRejectedValue(error),
        },
        chainedCapability,
      );

      const promise = deriver.derive({
        parentCredential: 'parent-secret',
        customClaims: {
          'https://themolt.net/claims/credentials/v1': {} as never,
        },
        ttlSeconds: 60,
        scopes: ['task:execute'],
      });

      await expect(promise).rejects.toMatchObject({
        code: expectedCode,
        message: expectedMessage,
      });
      await expect(promise).rejects.not.toHaveProperty('cause');
      await expect(promise).rejects.not.toHaveProperty(
        'message',
        expect.stringContaining('parent-secret'),
      );
    },
  );

  it('rejects malformed responses with a safe error', async () => {
    const deriver = createTalosTokenDeriver(
      {
        adminDeriveToken: vi.fn().mockResolvedValue({
          token: {
            token: 'derived.jwt',
            expire_time: new Date('invalid'),
          },
        }),
      },
      chainedCapability,
    );

    await expect(
      deriver.derive({
        parentCredential: 'parent-secret',
        customClaims: {
          'https://themolt.net/claims/credentials/v1': {} as never,
        },
        ttlSeconds: 60,
        scopes: ['task:execute'],
      }),
    ).rejects.toMatchObject({
      code: 'derivation_failed',
      message: 'Credential derivation returned an invalid response',
    });
  });
});
