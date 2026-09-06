import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkDaemonUpdate,
  compareVersions,
  daemonUpdateCommand,
  detectDaemonInstallMethod,
  resolveDaemonExecutable,
  UPDATE_NPM_REGISTRY_URL,
  UPDATE_RELEASES_URL,
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
      'curl -fsSL https://themolt.net/install/agent | MOLTNET_AGENT_VERSION=latest sh',
    );
  });

  it('reads the latest published version without credentials', async () => {
    const result = await checkDaemonUpdate({
      currentVersion: '0.49.1',
      force: true,
      executable: '/tmp/moltnet-agent',
      fetchFn: async () =>
        new Response(JSON.stringify([{ tag_name: 'agent-daemon-v0.50.0' }])),
    });
    expect(result.latestVersion).toBe('0.50.0');
    expect(result.updateAvailable).toBe(true);
  });
});

describe('resolveDaemonExecutable', () => {
  it('detects a global npm install reached through its bin shim', () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-shim-'));
    const pkg = join(root, 'node_modules', '@themoltnet', 'agent-daemon');
    mkdirSync(pkg, { recursive: true });
    mkdirSync(join(root, 'bin'), { recursive: true });
    const target = join(pkg, 'main.js');
    writeFileSync(target, '');
    const shim = join(root, 'bin', 'moltnet-agent');
    symlinkSync(target, shim);

    // The shim path alone carries no node_modules segment - that is exactly
    // why the unresolved check misreported every global npm install.
    expect(shim).not.toContain('/node_modules/');
    expect(detectDaemonInstallMethod(shim)).toBe('npm');
    // realpath also resolves the platform's own links (/var -> /private/var on
    // macOS), so compare the meaningful suffix rather than the absolute path.
    expect(resolveDaemonExecutable(shim)).toContain(
      '/node_modules/@themoltnet/agent-daemon/main.js',
    );
  });

  it('falls back to the input when the path does not exist', () => {
    expect(resolveDaemonExecutable('/nope/moltnet-agent')).toBe(
      '/nope/moltnet-agent',
    );
    expect(resolveDaemonExecutable('')).toBe('');
  });
});

describe('update source per install method', () => {
  const npmShim = '/x/node_modules/@themoltnet/agent-daemon/dist/main.js';

  it('asks the npm registry for an npm install', async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: string) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ version: '0.53.0' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const result = await checkDaemonUpdate({
      currentVersion: '0.52.0',
      force: true,
      executable: npmShim,
      fetchFn,
    });

    expect(result.installMethod).toBe('npm');
    expect(result.latestVersion).toBe('0.53.0');
    expect(result.updateAvailable).toBe(true);
    expect(seen).toEqual([UPDATE_NPM_REGISTRY_URL]);
  });

  it('asks the release listing for a bundle install and hands it an actionable command', async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: string) => {
      seen.push(String(url));
      return new Response(
        JSON.stringify([
          { tag_name: 'agent-daemon-v0.52.0' },
          { tag_name: 'agent-daemon-v0.54.0', draft: true },
          { tag_name: 'agent-daemon-v0.53.0' },
          { tag_name: 'cli-v1.91.0' },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await checkDaemonUpdate({
      currentVersion: '0.52.0',
      force: true,
      executable: '/opt/moltnet/bin/moltnet-agent',
      fetchFn,
    });

    expect(result.installMethod).toBe('bundle');
    // 0.54.0 is a draft and cli-v is another component; 0.53.0 wins despite
    // appearing after 0.52.0 in the listing.
    expect(result.latestVersion).toBe('0.53.0');
    expect(seen).toEqual([UPDATE_RELEASES_URL]);
    // The command must resolve the same version, or the check would keep
    // reporting an update the installer never applies.
    expect(result.command).toContain('MOLTNET_AGENT_VERSION=latest');
  });
});
