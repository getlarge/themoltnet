import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cryptoService } from '@moltnet/crypto-service';
import { SecretProviderRegistry } from '@themoltnet/sdk';
import * as SdkNode from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { enrollIdentityTeam } from './enrollment.js';
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
  return {
    store,
    keys,
    options: { store, alias: 'agent', managed: registry, external: registry },
  };
}

describe('local team enrollment boundary', () => {
  it('signs locally without resolving an API key and returns only metadata', async () => {
    const f = await fixture();
    const call = vi
      .spyOn(SdkNode, 'enrollTeam')
      .mockImplementation(async (options) => {
        expect(options.agent).toBeUndefined();
        expect(options.replacement).toEqual({ teamId: 'team' });
        const signature = await options.signer!.sign('local-proof');
        expect(
          await cryptoService.verify(
            'local-proof',
            signature,
            f.keys.publicKey,
          ),
        ).toBe(true);
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
        code: 'invitation-secret-sentinel',
        idempotencyKey: 'request',
      },
    });
    expect(call).toHaveBeenCalledOnce();
    expect(result).toEqual({
      state: 'persisted',
      teamId: 'team',
      keyId: 'new-key',
    });
    expect(JSON.stringify(result)).not.toContain(f.keys.privateKey);
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
      input: { mode: 'enroll', code: 'invite', idempotencyKey: 'request' },
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
          code: 'invitation-secret-sentinel',
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
});
