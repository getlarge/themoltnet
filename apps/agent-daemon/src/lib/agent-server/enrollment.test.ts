import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cryptoService } from '@moltnet/crypto-service';
import { SecretProviderRegistry } from '@themoltnet/sdk';
import * as SdkNode from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { enrollIdentityTeam } from './enrollment.js';
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
  return {
    store,
    keys,
    options: {
      oauth: { authorize: vi.fn() } as unknown as OperatorOAuth,
      apiUrl: 'https://api.themolt.net',
      store,
      alias: 'agent',
      managed: registry,
      external: registry,
    },
  };
}

describe('local team enrollment boundary', () => {
  it('requests human approval without resolving an API key and returns only metadata', async () => {
    const f = await fixture();
    vi.mocked(f.options.oauth.authorize).mockResolvedValue('human-approval');
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
    expect(f.options.oauth.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: expect.arrayContaining([
          'team:read',
          'diary:read',
          'task:execute',
        ]),
      }),
      undefined,
    );
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
});
