import { beforeEach, describe, expect, it, vi } from 'vitest';

const tls = vi.hoisted(() => ({
  ensureLocalTlsMaterial: vi.fn(),
  inspectLocalTlsMaterial: vi.fn(),
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
    tls.inspectLocalTlsMaterial.mockResolvedValue({ fingerprint: 'AA:BB:CC' });
    tls.isLocalCaTrusted.mockResolvedValue(false);
    tls.removeLocalCa.mockResolvedValue(undefined);
    tls.trustLocalCa.mockResolvedValue(undefined);
  });

  it('reports status without preparing material or modifying Keychain', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runTrustCommand(
      ['--status', '--json'],
      '/tmp/moltnet-test',
    );

    expect(code).toBe(0);
    expect(tls.ensureLocalTlsMaterial).not.toHaveBeenCalled();
    expect(tls.inspectLocalTlsMaterial).toHaveBeenCalledOnce();
    expect(tls.trustLocalCa).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        supported: true,
        trusted: false,
        fingerprint: 'AA:BB:CC',
      }),
    );
  });

  it('reports renewal required without preparing or removing certificates', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    tls.inspectLocalTlsMaterial.mockResolvedValue(null);
    expect(
      await runTrustCommand(['--status', '--json'], '/tmp/moltnet-test'),
    ).toBe(0);
    expect(tls.ensureLocalTlsMaterial).not.toHaveBeenCalled();
    expect(tls.removeLocalCa).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ supported: true, trusted: false, fingerprint: null }),
    );
  });

  it('removes existing trust without generating replacement material', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(
      await runTrustCommand(
        ['--remove', '--yes', '--json'],
        '/tmp/moltnet-test',
      ),
    ).toBe(0);
    expect(tls.removeLocalCa).toHaveBeenCalledOnce();
    expect(tls.ensureLocalTlsMaterial).not.toHaveBeenCalled();
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

  it('reports unsupported platforms without preparing TLS material', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    tls.isMacos.mockReturnValue(false);

    expect(
      await runTrustCommand(['--status', '--json'], '/tmp/moltnet-test'),
    ).toBe(0);

    expect(tls.ensureLocalTlsMaterial).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        supported: false,
        trusted: false,
        fingerprint: null,
      }),
    );
  });

  it('returns a failure code when TLS inspection fails', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    tls.inspectLocalTlsMaterial.mockRejectedValue(new Error('keychain denied'));

    const code = await runTrustCommand(
      ['--status', '--json'],
      '/tmp/moltnet-test',
    );

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'Agent Server trust command failed: keychain denied',
    );
  });

  it('rejects conflicting status mutation flags', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const code = await runTrustCommand(
      ['--status', '--yes'],
      '/tmp/moltnet-test',
    );

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'Usage: moltnet-agent server trust --status [--json]',
    );
    expect(tls.ensureLocalTlsMaterial).not.toHaveBeenCalled();
  });

  it('prints successful human-readable operations to stdout', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(await runTrustCommand(['--yes'], '/tmp/moltnet-test')).toBe(0);
    expect(log).toHaveBeenCalledWith(
      'MoltNet local HTTPS trust is ready for this macOS user.',
    );

    expect(
      await runTrustCommand(['--remove', '--yes'], '/tmp/moltnet-test'),
    ).toBe(0);
    expect(log).toHaveBeenCalledWith(
      'Removed the MoltNet local CA from your login keychain.',
    );
  });

  it('rejects server-only flags in trust mode', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const code = await runTrustCommand(
      ['--port', '17374', '--status', '--json'],
      '/tmp/moltnet-test',
    );

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown option'),
    );
  });
});
