import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MoltNetConfig } from '../src/credentials.js';
import {
  READ_ONLY_CAPABILITIES,
  SecretProviderRegistry,
} from '../src/secrets.js';
import { exportSSHKey } from '../src/ssh.js';

// Zero seed from test vectors
const ZERO_SEED = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const ZERO_PUBLIC_KEY = 'ed25519:O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=';

const sampleConfig: MoltNetConfig = {
  identity_id: 'uuid-ssh-test',
  registered_at: '2026-01-01T00:00:00.000Z',
  oauth2: { client_id: 'cid', client_secret: 'csec' },
  keys: {
    public_key: ZERO_PUBLIC_KEY,
    private_key: ZERO_SEED,
    fingerprint: 'TEST-FINGERPRINT',
  },
  endpoints: {
    api: 'https://api.themolt.net',
    mcp: 'https://mcp.themolt.net/mcp',
  },
};

describe('exportSSHKey', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'moltnet-ssh-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeTestConfig(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'moltnet.json'),
      JSON.stringify(sampleConfig, null, 2),
    );
  }

  it('writes id_ed25519 and id_ed25519.pub to output dir', async () => {
    // Arrange
    const configDir = join(tempDir, 'config');
    const outputDir = join(tempDir, 'ssh-out');
    await writeTestConfig(configDir);

    // Act
    const result = await exportSSHKey({ configDir, outputDir });

    // Assert
    expect(result.privatePath).toBe(join(outputDir, 'id_ed25519'));
    expect(result.publicPath).toBe(join(outputDir, 'id_ed25519.pub'));

    const privContent = await readFile(result.privatePath, 'utf-8');
    expect(privContent).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(privContent).toContain('-----END OPENSSH PRIVATE KEY-----');

    const pubContent = await readFile(result.publicPath, 'utf-8');
    expect(pubContent).toMatch(/^ssh-ed25519 /);
  });

  it.runIf(process.platform !== 'win32')(
    'sets private key file permissions to 0o600',
    async () => {
      // Arrange
      const configDir = join(tempDir, 'config');
      const outputDir = join(tempDir, 'ssh-out');
      await writeTestConfig(configDir);

      // Act
      const result = await exportSSHKey({ configDir, outputDir });

      // Assert
      const info = await stat(result.privatePath);
      expect(info.mode & 0o777).toBe(0o600);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'sets public key file permissions to 0o644',
    async () => {
      // Arrange
      const configDir = join(tempDir, 'config');
      const outputDir = join(tempDir, 'ssh-out');
      await writeTestConfig(configDir);

      // Act
      const result = await exportSSHKey({ configDir, outputDir });

      // Assert
      const info = await stat(result.publicPath);
      expect(info.mode & 0o777).toBe(0o644);
    },
  );

  it('updates ssh section in moltnet.json with correct paths', async () => {
    // Arrange
    const configDir = join(tempDir, 'config');
    const outputDir = join(tempDir, 'ssh-out');
    await writeTestConfig(configDir);

    // Act
    await exportSSHKey({ configDir, outputDir });

    // Assert
    const raw = await readFile(join(configDir, 'moltnet.json'), 'utf-8');
    const updated = JSON.parse(raw) as MoltNetConfig;
    expect(updated.ssh).toEqual({
      private_key_path: join(outputDir, 'id_ed25519'),
      public_key_path: join(outputDir, 'id_ed25519.pub'),
    });
  });

  it('throws with clear message when no config found', async () => {
    // Arrange
    const emptyDir = join(tempDir, 'empty');
    await mkdir(emptyDir, { recursive: true });

    // Act & Assert
    await expect(
      exportSSHKey({ configDir: emptyDir, outputDir: tempDir }),
    ).rejects.toThrow('No config found');
  });

  it('creates output directory recursively when it does not exist', async () => {
    // Arrange
    const configDir = join(tempDir, 'config');
    const outputDir = join(tempDir, 'nested', 'deep', 'ssh');
    await writeTestConfig(configDir);

    // Act
    const result = await exportSSHKey({ configDir, outputDir });

    // Assert
    const info = await stat(result.privatePath);
    expect(info.isFile()).toBe(true);
  });

  it('exports a keypair from keys.private_key_ref through the supplied registry', async () => {
    const configDir = join(tempDir, 'config');
    await mkdir(configDir, { recursive: true });
    const { private_key: _seed, ...keys } = sampleConfig.keys;
    await writeFile(
      join(configDir, 'moltnet.json'),
      JSON.stringify({
        ...sampleConfig,
        keys: {
          ...keys,
          private_key_ref: {
            provider: 'memory',
            key: 'identity/TEST-FINGERPRINT/seed',
          },
        },
      }),
    );
    const registry = new SecretProviderRegistry().register({
      name: 'memory',
      capabilities: READ_ONLY_CAPABILITIES,
      read: async () => ZERO_SEED,
      probe: async () => 'present',
    });

    const result = await exportSSHKey({
      configDir,
      outputDir: join(tempDir, 'ssh'),
      secretProviders: registry,
    });

    expect(await readFile(result.publicPath, 'utf8')).toContain('ssh-ed25519');
    expect((await stat(result.privatePath)).mode & 0o777).toBe(0o600);
    const written = JSON.parse(
      await readFile(join(configDir, 'moltnet.json'), 'utf8'),
    );
    expect(written.keys.private_key_ref).toEqual({
      provider: 'memory',
      key: 'identity/TEST-FINGERPRINT/seed',
    });
    expect(written.keys.private_key).toBeUndefined();
  });
});
