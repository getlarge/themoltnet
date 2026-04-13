import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findInstallationForOwner } from '@themoltnet/github-agent';
import { type MoltNetConfig, readConfig, writeConfig } from '@themoltnet/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeEnvFile } from '../env-file.js';
import { runPortResolveInstallationPhase } from './portResolveInstallation.js';

vi.mock('@themoltnet/github-agent', () => ({
  findInstallationForOwner: vi.fn(),
}));

const baseConfig: MoltNetConfig = {
  identity_id: '11111111-1111-1111-1111-111111111111',
  registered_at: '2025-01-01T00:00:00.000Z',
  oauth2: { client_id: 'cid', client_secret: 'csec' },
  keys: {
    public_key: 'ed25519:abc',
    private_key: 'ed25519:priv',
    fingerprint: 'ed25519:fp',
  },
  endpoints: {
    api: 'https://api.themolt.net',
    mcp: 'https://mcp.themolt.net/mcp',
  },
  github: {
    app_id: '2878569',
    app_slug: 'legreffier',
    installation_id: '110518607',
    private_key_path: '/tmp/legreffier.pem',
  },
};

let targetDir: string;

beforeEach(async () => {
  targetDir = await mkdtemp(join(tmpdir(), 'port-resolve-'));
  // Seed a moltnet.json so updateConfigSection can read it
  await writeConfig(baseConfig, targetDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(targetDir, { recursive: true, force: true });
});

describe('runPortResolveInstallationPhase', () => {
  it('skips when currentRepo is absent', async () => {
    const result = await runPortResolveInstallationPhase({
      targetDir,
      config: baseConfig,
    });

    expect(result.status).toBe('skipped');
    expect(result.installationId).toBe('110518607');
  });

  it('skips when github.app_id is missing', async () => {
    const config = {
      ...baseConfig,
      github: undefined,
    };

    const result = await runPortResolveInstallationPhase({
      targetDir,
      config,
      currentRepo: 'innovation-system/on-board-nx',
    });

    expect(result.status).toBe('skipped');
  });

  it('returns not-installed when app has no installation for target owner', async () => {
    vi.mocked(findInstallationForOwner).mockResolvedValue(null);

    const result = await runPortResolveInstallationPhase({
      targetDir,
      config: baseConfig,
      currentRepo: 'innovation-system/on-board-nx',
    });

    expect(result.status).toBe('not-installed');
    expect(result.message).toContain('innovation-system');
    expect(vi.mocked(findInstallationForOwner)).toHaveBeenCalledWith({
      appId: '2878569',
      privateKeyPath: '/tmp/legreffier.pem',
      owner: 'innovation-system',
    });
  });

  it('returns unchanged when installation_id already matches', async () => {
    vi.mocked(findInstallationForOwner).mockResolvedValue({
      installationId: '110518607',
    });

    const result = await runPortResolveInstallationPhase({
      targetDir,
      config: baseConfig,
      currentRepo: 'getlarge/themoltnet',
    });

    expect(result.status).toBe('unchanged');
    expect(result.installationId).toBe('110518607');
  });

  it('updates installation_id when target owner has a different installation', async () => {
    vi.mocked(findInstallationForOwner).mockResolvedValue({
      installationId: '999888777',
    });

    const result = await runPortResolveInstallationPhase({
      targetDir,
      config: baseConfig,
      currentRepo: 'innovation-system/on-board-nx',
    });

    expect(result.status).toBe('updated');
    expect(result.installationId).toBe('999888777');
    expect(result.message).toContain('110518607');
    expect(result.message).toContain('999888777');

    // Verify moltnet.json was updated on disk
    const updated = await readConfig(targetDir);
    expect(updated?.github?.installation_id).toBe('999888777');
  });

  it('updates the env file when envPrefix is provided', async () => {
    vi.mocked(findInstallationForOwner).mockResolvedValue({
      installationId: '999888777',
    });

    // Seed an env file with the old installation_id
    await writeEnvFile({
      envDir: targetDir,
      agentName: 'legreffier',
      prefix: 'LEGREFFIER',
      clientId: 'cid',
      clientSecret: 'csec',
      appId: '2878569',
      pemPath: '/tmp/legreffier.pem',
      installationId: '110518607',
    });

    const result = await runPortResolveInstallationPhase({
      targetDir,
      config: baseConfig,
      currentRepo: 'innovation-system/on-board-nx',
      envPrefix: 'LEGREFFIER',
    });

    expect(result.status).toBe('updated');

    const envContent = await readFile(join(targetDir, 'env'), 'utf-8');
    expect(envContent).toContain(
      "LEGREFFIER_GITHUB_APP_INSTALLATION_ID='999888777'",
    );
    expect(envContent).not.toContain('110518607');
  });

  it('downgrades to skipped on API errors', async () => {
    vi.mocked(findInstallationForOwner).mockRejectedValue(
      new Error(
        'GitHub API error listing installations (401): Bad credentials',
      ),
    );

    const result = await runPortResolveInstallationPhase({
      targetDir,
      config: baseConfig,
      currentRepo: 'innovation-system/on-board-nx',
    });

    expect(result.status).toBe('skipped');
    expect(result.message).toContain('401');
  });
});
