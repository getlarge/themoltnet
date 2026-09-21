import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  legacyStoreNotice,
  loadAgentServerEnvConfig,
  loadConfig,
  loadUpdateEnvConfig,
} from './config.js';

describe('loadConfig observability settings', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('does not repeat a notice inherited from the parent CLI', () => {
    vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', '/store');
    vi.stubEnv('MOLTNET_LEGACY_STORE_NOTICE_SHOWN', '1');
    expect(legacyStoreNotice()).toBeUndefined();
  });
  it.each([undefined, '/same-store'])(
    'announces the legacy name even with MOLTNET_HOME=%s',
    (shared) => {
      vi.stubEnv('MOLTNET_HOME', shared);
      vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', undefined);
      expect(legacyStoreNotice()).toBeUndefined();
      vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', '/same-store');
      expect(legacyStoreNotice()).toContain('is deprecated; use MOLTNET_HOME');
    },
  );

  it('shares MOLTNET_HOME across direct workers and the server', () => {
    vi.stubEnv('MOLTNET_HOME', '/isolated-moltnet-store');
    vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', undefined);
    expect(loadConfig().agentServerRoot).toBe('/isolated-moltnet-store');
    expect(loadAgentServerEnvConfig().root).toBe('/isolated-moltnet-store');
  });

  it('keeps full idle polling traces disabled by default', () => {
    expect(loadConfig().traceIdlePolling).toBe(false);
  });

  it('enables full idle polling traces only with an explicit boolean', () => {
    vi.stubEnv('MOLTNET_TRACE_IDLE_POLLING', 'true');
    expect(loadConfig().traceIdlePolling).toBe(true);

    vi.stubEnv('MOLTNET_TRACE_IDLE_POLLING', 'yes');
    expect(() => loadConfig()).toThrow(
      'MOLTNET_TRACE_IDLE_POLLING must be either true or false',
    );
  });

  it('reads executor signing material without transforming it', () => {
    vi.stubEnv('MOLTNET_PRIVATE_KEY', 'base64-seed');
    expect(loadConfig().signingPrivateKey).toBe('base64-seed');
  });

  it('loads the Agent Server active identity override', () => {
    vi.stubEnv('MOLTNET_ACTIVE_IDENTITY', 'legreffier');

    expect(loadAgentServerEnvConfig().activeIdentity).toBe('legreffier');
  });

  it('reads seed and agent-key references and rejects a value together with its reference', () => {
    vi.stubEnv('MOLTNET_PRIVATE_KEY_REF', 'file:identity.fp.seed');
    vi.stubEnv('MOLTNET_AGENT_KEY_REF', 'file:agent-key.id');
    expect(loadConfig().signingPrivateKeyRef).toBe('file:identity.fp.seed');
    expect(loadConfig().credentialSource).toBe('environment');

    vi.stubEnv('MOLTNET_PRIVATE_KEY', 'base64-seed');
    expect(() => loadConfig()).toThrow(
      'Set only one of MOLTNET_PRIVATE_KEY or MOLTNET_PRIVATE_KEY_REF',
    );
    vi.stubEnv('MOLTNET_PRIVATE_KEY', '');
    vi.stubEnv('MOLTNET_AGENT_KEY', 'ak');
    expect(() => loadConfig()).toThrow(
      'Set only one of MOLTNET_AGENT_KEY or MOLTNET_AGENT_KEY_REF',
    );
  });

  it('loads Agent Server subject pins atomically', () => {
    vi.stubEnv('MOLTNET_EXPECTED_SUBJECT_ID', 'agent-1');
    expect(() => loadConfig()).toThrow('must be set together');

    vi.stubEnv('MOLTNET_EXPECTED_SUBJECT_TYPE', 'agent');
    vi.stubEnv('MOLTNET_EXPECTED_PUBLIC_KEY', 'pk-1');
    vi.stubEnv('MOLTNET_EXPECTED_FINGERPRINT', 'fp-1');
    expect(loadConfig().expectedAgent).toEqual({
      subjectId: 'agent-1',
      subjectType: 'agent',
      publicKey: 'pk-1',
      fingerprint: 'fp-1',
    });
  });

  it('rejects the obsolete identity pin instead of silently disabling pinning', () => {
    vi.stubEnv('MOLTNET_EXPECTED_IDENTITY_ID', 'identity-1');
    expect(() => loadConfig()).toThrow(
      'MOLTNET_EXPECTED_IDENTITY_ID is no longer supported',
    );
  });
});

it('keeps update caches stable through default-store aliases', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'update-root-')));
  try {
    vi.stubEnv('HOME', home);
    vi.stubEnv('MOLTNET_HOME', join(home, '.config/moltnet'));
    vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', undefined);
    expect(loadUpdateEnvConfig().storeRoot).toBeUndefined();
  } finally {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});
