import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DAEMON_MINIMUM_SCOPES } from '@moltnet/models';
import {
  READ_ONLY_CAPABILITIES,
  SecretProviderRegistry,
  type Whoami,
} from '@themoltnet/sdk';
import type { connect } from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentServerStore } from './store.js';
import {
  credentialBlocker,
  requireCredentialSnapshot,
  verifyTeamActivation,
} from './team-credentials.js';

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'team-credentials-'));
  roots.push(root);
  const store = new AgentServerStore(root).ensure();
  store.writeAgentConfig('agent', {
    subject_id: 'subject',
    subject_type: 'agent',
    registered_at: '2026-09-18T00:00:00Z',
    agent_key_ref: { provider: 'memory', key: 'agent-key/subject' },
    agent_key_refs: {
      a: { provider: 'memory', key: 'agent-key/subject/a' },
      b: { provider: 'memory', key: 'agent-key/subject/b' },
    },
    keys: {
      public_key: 'public',
      fingerprint: 'fingerprint',
      private_key_ref: { provider: 'memory', key: 'identity/fingerprint/seed' },
    },
    endpoints: {
      api: 'https://api.themolt.net',
      mcp: 'https://mcp.themolt.net',
    },
  });
  store.writeActivation({
    source: 'managed',
    alias: 'agent',
    subjectId: 'subject',
    publicKey: 'public',
    fingerprint: 'fingerprint',
    createdAt: '2026-09-18T00:00:00Z',
    apiUrl: 'https://api.themolt.net',
  });
  const values: Record<string, string> = {
    'agent-key/subject/a': 'secret-a',
    'agent-key/subject/b': 'secret-b',
    'agent-key/subject': 'fallback-secret',
  };
  const read = vi.fn(async (key: string) => values[key] ?? null);
  const registry = new SecretProviderRegistry().register({
    name: 'memory',
    capabilities: READ_ONLY_CAPABILITIES,
    read,
    probe: async () => 'present',
  });
  const response = (teamId: string): Whoami => ({
    subjectType: 'agent',
    subjectId: 'subject',
    identityId: 'subject',
    publicKey: 'public',
    fingerprint: 'fingerprint',
    scopes: [...DAEMON_MINIMUM_SCOPES, 'team:read', 'diary:read'],
    credentialBinding: {
      bindingScope: 'team',
      boundTeamId: teamId,
      keyId: `key-${teamId}`,
      expiresAt: '2026-09-25T00:00:00Z',
    },
  });
  const whoami = vi.fn(async (key: string) => response(key.slice(-1)));
  const connectImpl = vi.fn(async (options: Parameters<typeof connect>[0]) => ({
    agents: { whoami: () => whoami(options?.agentKey ?? '') },
  })) as unknown as typeof connect;
  const verify = (teamId: string) =>
    verifyTeamActivation(
      store,
      'agent',
      registry,
      registry,
      connectImpl,
      undefined,
      teamId,
    );
  return { store, root, values, read, response, whoami, verify, connectImpl };
}

describe('strict supervised credentials', () => {
  it('captures independent team credentials once and retains predecessor after replacement', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.verify('a'), f.verify('b')]);
    f.values['agent-key/subject/a'] = 'replacement-a';
    expect(requireCredentialSnapshot(a).agentKey).toBe('secret-a');
    expect(requireCredentialSnapshot(b).agentKey).toBe('secret-b');
    expect(f.read.mock.calls.flat()).not.toContain('agent-key/subject');
    expect(f.whoami).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(a)).not.toContain('secret-a');
    const restarted = new AgentServerStore(f.root).ensure();
    expect(restarted.readActivation('agent')?.credentialHealth?.a?.keyId).toBe(
      'key-a',
    );
  });

  it('never falls back for missing or unavailable slots', async () => {
    const f = fixture();
    delete f.values['agent-key/subject/a'];
    await expect(f.verify('a')).rejects.toMatchObject({
      blocker: { code: 'agent_key_unavailable' },
    });
    await expect(f.verify('missing')).rejects.toMatchObject({
      blocker: { code: 'agent_key_missing' },
    });
    expect(f.connectImpl).not.toHaveBeenCalled();
    expect(f.read.mock.calls.flat()).not.toContain('agent-key/subject');
    await expect(f.verify('b')).resolves.toBeDefined();
  });

  it.each(['identity', 'wrong-team', 'wrong-subject', 'wrong-signing-key'])(
    'rejects %s binding',
    async (kind) => {
      const f = fixture();
      const value = f.response('a');
      if (kind === 'identity')
        value.credentialBinding = {
          bindingScope: 'identity',
          keyId: 'key',
          expiresAt: null,
        };
      if (kind === 'wrong-team')
        value.credentialBinding = f.response('b').credentialBinding;
      if (kind === 'wrong-subject') value.subjectId = 'other';
      if (kind === 'wrong-signing-key') value.publicKey = 'other';
      f.whoami.mockResolvedValue(value);
      await expect(f.verify('a')).rejects.toMatchObject({
        blocker: { code: 'agent_key_binding_invalid' },
      });
    },
  );

  it('diagnoses missing scopes only from verified metadata and preserves unknown expiry', async () => {
    const f = fixture();
    const value = f.response('a');
    delete value.credentialBinding!.expiresAt;
    value.scopes = [];
    f.whoami.mockResolvedValue(value);
    await expect(f.verify('a')).rejects.toMatchObject({
      blocker: { code: 'agent_key_scopes_insufficient' },
    });
    expect(
      f.store.readActivation('agent')?.credentialHealth?.a,
    ).not.toHaveProperty('expiresAt');
    expect(
      credentialBlocker(Object.assign(new Error('secret'), { statusCode: 403 }))
        .code,
    ).toBe('agent_key_unavailable');
  });
});
