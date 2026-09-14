import { beforeEach, describe, expect, it, vi } from 'vitest';

const tls = vi.hoisted(() => ({
  ensureLocalTlsMaterial: vi.fn(),
  isLocalCaTrusted: vi.fn(),
  isMacos: vi.fn(),
  removeLocalCa: vi.fn(),
  trustLocalCa: vi.fn(),
}));

vi.mock('../lib/agent-server/tls.js', () => tls);

import { runTrustCommand } from './server.js';

describe('server trust machine-readable contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tls.isMacos.mockReturnValue(true);
    tls.ensureLocalTlsMaterial.mockResolvedValue({
      fingerprint: 'AA:BB:CC',
    });
    tls.isLocalCaTrusted.mockResolvedValue(false);
    tls.removeLocalCa.mockResolvedValue(undefined);
    tls.trustLocalCa.mockResolvedValue(undefined);
  });

  it('prepares material and reports status without modifying Keychain', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runTrustCommand(
      ['--status', '--json'],
      '/tmp/moltnet-test',
    );

    expect(code).toBe(0);
    expect(tls.ensureLocalTlsMaterial).toHaveBeenCalledOnce();
    expect(tls.trustLocalCa).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        supported: true,
        trusted: false,
        fingerprint: 'AA:BB:CC',
      }),
    );
  });

  it('requires explicit consent for JSON mutations', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await runTrustCommand(['--json'], '/tmp/moltnet-test');

    expect(code).toBe(1);
    expect(tls.trustLocalCa).not.toHaveBeenCalled();
  });

  it('installs and removes trust after native consent', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    tls.isLocalCaTrusted.mockResolvedValue(true);

    expect(
      await runTrustCommand(['--yes', '--json'], '/tmp/moltnet-test'),
    ).toBe(0);
    expect(tls.trustLocalCa).toHaveBeenCalledOnce();

    expect(
      await runTrustCommand(
        ['--remove', '--yes', '--json'],
        '/tmp/moltnet-test',
      ),
    ).toBe(0);
    expect(tls.removeLocalCa).toHaveBeenCalledOnce();
  });
});
