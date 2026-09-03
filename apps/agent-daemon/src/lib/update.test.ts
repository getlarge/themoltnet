import { describe, expect, it } from 'vitest';

import {
  checkDaemonUpdate,
  compareVersions,
  daemonUpdateCommand,
  detectDaemonInstallMethod,
} from './update.js';

describe('daemon update discovery', () => {
  it('compares stable semver versions', () => {
    expect(compareVersions('0.50.0', '0.49.1')).toBe(1);
    expect(compareVersions('0.49.1', '0.50.0')).toBe(-1);
    expect(compareVersions('broken', '0.50.0')).toBe(0);
  });

  it('detects local installation channels and renders safe commands', () => {
    expect(
      detectDaemonInstallMethod(
        '/usr/lib/node_modules/@themoltnet/agent-daemon/dist/main.js',
      ),
    ).toBe('npm');
    expect(detectDaemonInstallMethod('/opt/moltnet/bin/moltnet-agent')).toBe(
      'bundle',
    );
    expect(daemonUpdateCommand('npm')).toBe(
      'npm install -g @themoltnet/agent-daemon@latest',
    );
    expect(daemonUpdateCommand('direct')).toBe(
      'curl -fsSL https://themolt.net/install/agent | sh',
    );
  });

  it('reads the pinned stable version without credentials', async () => {
    const result = await checkDaemonUpdate({
      currentVersion: '0.49.1',
      force: true,
      executable: '/tmp/moltnet-agent',
      fetchFn: async () =>
        new Response(JSON.stringify({ agent: { version: '0.50.0' } })),
    });
    expect(result.latestVersion).toBe('0.50.0');
    expect(result.updateAvailable).toBe(true);
  });
});
