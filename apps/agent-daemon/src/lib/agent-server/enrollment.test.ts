import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { cryptoService, enrollmentProofMessage } from '@moltnet/crypto-service';
import { SecretProviderRegistry } from '@themoltnet/sdk';
import * as SdkNode from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  enrollIdentityTeam,
  listIdentityEnrollmentRecoveries,
} from './enrollment.js';
import type { OperatorOAuth } from './operator-oauth.js';
import { AgentServerStore } from './store.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
async function fixture(activated = true) {
  const root = mkdtempSync(join(tmpdir(), 'server-enrollment-'));
  roots.push(root);
  const store = new AgentServerStore(root).ensure();
  const keys = await cryptoService.generateKeyPair();
  const provider = new SdkNode.FileSecretProvider({
    root: store.secretsDir,
    writable: true,
  });
  const reference = {
    provider: 'file',
    key: `identity/${keys.fingerprint}/seed`,
  };
  await provider.write(reference.key, keys.privateKey);
  store.writeAgentConfig('agent', {
    subject_id: 'subject',
    subject_type: 'agent',
    registered_at: '2026-09-18T00:00:00Z',
    agent_key_refs: {
      team: { provider: 'file', key: 'agent-key/subject/team' },
    },
    keys: {
      public_key: keys.publicKey,
      fingerprint: keys.fingerprint,
      private_key_ref: reference,
    },
    endpoints: {
      api: 'https://api.themolt.net',
      mcp: 'https://mcp.themolt.net',
    },
  });
  if (activated)
    store.writeActivation({
      source: 'managed',
      alias: 'agent',
      subjectId: 'subject',
      publicKey: keys.publicKey,
      fingerprint: keys.fingerprint,
      createdAt: '2026-09-18T00:00:00Z',
      apiUrl: 'https://api.themolt.net',
    });
  const registry = new SecretProviderRegistry().register(provider);
  const authorize = vi.fn<OperatorOAuth['authorize']>();
  return {
    authorize,
    store,
    keys,
    options: {
      oauth: { authorize } as unknown as OperatorOAuth,
      apiUrl: 'https://api.themolt.net',
      store,
      alias: 'agent',
      managed: registry,
      external: registry,
    },
  };
}

describe('local team enrollment boundary', () => {
  it('rejects invalid team scope requests as client errors before approval', async () => {
    const { options, authorize } = await fixture();
    await expect(
      enrollIdentityTeam({
        ...options,
        input: {
          teamId: 'team',
          idempotencyKey: 'bad-scopes',
          mode: 'enroll',
          scopes: ['team:manage'],
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_scopes' });
    expect(authorize).not.toHaveBeenCalled();
  });
  it('lists recovery metadata from the Agent Server identity store', async () => {
    const f = await fixture();
    const recoveryDir = join(
      f.store.identityDir('agent'),
      'credential-recovery',
    );
    mkdirSync(recoveryDir, { recursive: true });
    const recoveryId = '11111111-1111-4111-8111-111111111111.json';
    writeFileSync(
      join(recoveryDir, recoveryId),
      JSON.stringify({
        version: 1,
        configDir: f.store.identityDir('agent'),
        secretCaptured: false,
        retryContext: { provisioning: { teamId: 'team', operation: 'renew' } },
      }),
    );
    const result = await listIdentityEnrollmentRecoveries({
      store: f.store,
      alias: 'agent',
      managed: f.options.managed,
      external: f.options.external,
    });
    expect(result.items).toMatchObject([
      { recoveryId, secretCaptured: false, teamId: 'team', operation: 'renew' },
    ]);
  });
  it('requests human approval without resolving an API key and returns only metadata', async () => {
    const f = await fixture();
    f.authorize.mockResolvedValue('human-approval');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ key: { id: 'new-key' }, secret: 'captured' }),
      ),
    );
    const call = vi
      .spyOn(SdkNode, 'enrollTeam')
      .mockImplementation(async (options) => {
        expect(options.agent).toBeUndefined();
        expect(options.replacement).toEqual({ teamId: 'team' });
        expect(options.provision).toBeTypeOf('function');
        expect(options.provisioningContext?.scopes).toEqual(
          expect.arrayContaining(['team:read', 'diary:read', 'task:execute']),
        );
        await options.provision!();
        return {
          teamId: 'team',
          key: { id: 'new-key' },
          secret: 'secret-sentinel',
        } as unknown as SdkNode.EnrollTeamResult;
      });
    const result = await enrollIdentityTeam({
      ...f.options,
      input: {
        mode: 'replace',
        teamId: 'team',

        idempotencyKey: 'request',
      },
    });
    expect(call).toHaveBeenCalledOnce();
    expect(f.authorize).toHaveBeenCalledOnce();
    expect(f.authorize.mock.calls[0]?.[0]?.scopes).toEqual(
      expect.arrayContaining(['team:read', 'diary:read', 'task:execute']),
    );
    expect(result).toEqual({
      state: 'persisted',
      teamId: 'team',
      keyId: 'new-key',
      scopes: [],
    });
    expect(JSON.stringify(result)).not.toContain(f.keys.privateKey);
  });

  it('signs the exact approved enrollment using the protected identity key', async () => {
    const f = await fixture();
    f.authorize.mockResolvedValue('human-approval');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ key: { id: 'new-key' }, secret: 'captured' }),
        ),
      );
    vi.spyOn(SdkNode, 'enrollTeam').mockImplementation(async (options) => {
      await options.provision!();
      return {
        teamId: 'team',
        key: { id: 'new-key' },
      } as SdkNode.EnrollTeamResult;
    });
    await enrollIdentityTeam({
      ...f.options,
      input: { mode: 'enroll', teamId: 'team', idempotencyKey: 'request' },
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string) as {
      agentProof: string;
    };
    expect(
      await cryptoService.verify(
        enrollmentProofMessage({
          accessToken: 'human-approval',
          grant: f.authorize.mock.calls[0][0]!,
        }),
        body.agentProof,
        f.keys.publicKey,
      ),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain(f.keys.privateKey);
  });

  it('enrolls a local identity before first activation without needing its expired credential', async () => {
    const f = await fixture(false);
    vi.spyOn(SdkNode, 'enrollTeam').mockResolvedValue({
      teamId: 'team',
      key: { id: 'new-key' },
    } as SdkNode.EnrollTeamResult);
    expect(f.store.readActivation('agent')).toBeNull();
    await enrollIdentityTeam({
      ...f.options,
      input: { mode: 'enroll', teamId: 'team', idempotencyKey: 'request' },
    });
    expect(f.store.readActivation('agent')).toMatchObject({
      subjectId: 'subject',
      publicKey: f.keys.publicKey,
    });
  });

  it.each([false, true])(
    'reports captured=%s accurately without exposing paths or secrets',
    async (captured) => {
      const f = await fixture();
      vi.spyOn(SdkNode, 'enrollTeam').mockRejectedValue(
        captured
          ? new SdkNode.CredentialPersistenceError(
              '/protected/recovery/artifact.json',
              true,
              'issued-key',
            )
          : new SdkNode.EnrollmentRecoveryError(
              '/protected/recovery/artifact.json',
              'issued-key',
              409,
            ),
      );
      const result = await enrollIdentityTeam({
        ...f.options,
        input: {
          mode: 'enroll',
          teamId: 'team',
          idempotencyKey: 'request',
        },
      });
      expect(result).toMatchObject({
        state: 'recovery_required',
        secretCaptured: captured,
        issuedKeyId: 'issued-key',
        recoveryId: 'artifact.json',
      });
      expect(JSON.stringify(result)).not.toContain('/protected');
      expect(JSON.stringify(result)).not.toContain(
        'invitation-secret-sentinel',
      );
    },
  );

  it('treats an API rate limit as retryable without retaining a recovery record', async () => {
    const f = await fixture();
    f.authorize.mockResolvedValue('human-approval');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED' }), {
        status: 429,
        headers: { 'retry-after': '34' },
      }),
    );

    const result = await enrollIdentityTeam({
      ...f.options,
      input: { mode: 'replace', teamId: 'team', idempotencyKey: 'request' },
    });

    expect(result).toEqual({
      state: 'retryable',
      retryAfter: 34,
      message:
        'The approval service is busy. Retry in 34 seconds; no credential was issued.',
    });
    expect(
      readdirSync(
        join(dirname(f.store.agentPath('agent')), 'credential-recovery'),
      ),
    ).toEqual([]);
  });

  it.each([
    { status: 429, code: 'OTHER_LIMIT' },
    { status: 503, code: 'SERVICE_UNAVAILABLE' },
  ])(
    'retains uncertainty for non-definitive provisioning failure $status/$code',
    async ({ status, code }) => {
      const f = await fixture();
      f.authorize.mockResolvedValue('human-approval');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ code }), { status }),
      );
      const result = await enrollIdentityTeam({
        ...f.options,
        input: { mode: 'replace', teamId: 'team', idempotencyKey: 'request' },
      });
      expect(result).toMatchObject({
        state: 'recovery_required',
        secretCaptured: false,
      });
      expect(
        readdirSync(
          join(dirname(f.store.agentPath('agent')), 'credential-recovery'),
        ),
      ).toHaveLength(1);
    },
  );
});
