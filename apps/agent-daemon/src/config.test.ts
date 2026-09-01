import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig observability settings', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('reads seed and agent-key references and rejects a value together with its reference', () => {
    vi.stubEnv('MOLTNET_PRIVATE_KEY_REF', 'file:identity.fp.seed');
    vi.stubEnv('MOLTNET_AGENT_KEY_REF', 'file:agent-key.id');
    expect(loadConfig().signingPrivateKeyRef).toBe('file:identity.fp.seed');
    expect(loadConfig().authMode).toBe('agent-key');

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

  it('loads serve identity pins atomically', () => {
    vi.stubEnv('MOLTNET_EXPECTED_IDENTITY_ID', 'id-1');
    expect(() => loadConfig()).toThrow('must be set together');

    vi.stubEnv('MOLTNET_EXPECTED_PUBLIC_KEY', 'pk-1');
    vi.stubEnv('MOLTNET_EXPECTED_FINGERPRINT', 'fp-1');
    expect(loadConfig().expectedIdentity).toEqual({
      identityId: 'id-1',
      publicKey: 'pk-1',
      fingerprint: 'fp-1',
    });
  });
});
