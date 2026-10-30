import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toSSHPublicKey } from '@moltnet/crypto-service';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupGitIdentity } from '../src/git-setup.js';

// Zero seed vector for deterministic test keys
const ZERO_SEED_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const TEST_PUBLIC_KEY = 'ed25519:O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=';
const TEST_SUBJECT_ID = 'test-agent-1234-5678-abcd-ef0123456789';
const TEST_GIT_NAME = 'MoltNet Test Agent';
const TEST_GIT_EMAIL = 'test-agent@example.test';

function createTestConfig(opts?: {
  withSsh?: boolean;
  sshPublicKeyPath?: string;
  sshPrivateKeyPath?: string;
}) {
  const config: Record<string, unknown> = {
    subject_id: TEST_SUBJECT_ID,
    subject_type: 'agent',
    registered_at: '2025-01-01T00:00:00.000Z',
    oauth2: { client_id: 'test-client', client_secret: 'test-secret' },
    keys: {
      public_key: TEST_PUBLIC_KEY,
      private_key: ZERO_SEED_BASE64,
      fingerprint: 'test-fingerprint',
    },
    endpoints: {
      api: 'https://api.themolt.net',
      mcp: 'https://mcp.themolt.net/mcp',
    },
    git: {
      name: TEST_GIT_NAME,
      email: TEST_GIT_EMAIL,
      signing: true,
      config_path: '/tmp/gitconfig',
    },
  };

  if (opts?.withSsh) {
    config.ssh = {
      private_key_path: opts.sshPrivateKeyPath ?? '/tmp/id_ed25519',
      public_key_path: opts.sshPublicKeyPath ?? '/tmp/id_ed25519.pub',
    };
  }

  return config;
}

describe('setupGitIdentity', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'moltnet-git-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should throw when no config found', async () => {
    // Arrange — empty temp dir, no moltnet.json

    // Act & Assert
    await expect(setupGitIdentity({ configDir: tempDir })).rejects.toThrow(
      'No config found',
    );
  });

  it('should throw when SSH keys not exported', async () => {
    // Arrange — config without ssh section
    const config = createTestConfig({ withSsh: false });
    await writeFile(
      join(tempDir, 'moltnet.json'),
      JSON.stringify(config, null, 2),
    );

    // Act & Assert
    await expect(setupGitIdentity({ configDir: tempDir })).rejects.toThrow(
      'SSH keys not exported',
    );
  });

  it('refuses to invent missing Git authorship from a MoltNet identifier', async () => {
    const config = createTestConfig({ withSsh: true });
    delete config.git;
    await writeFile(
      join(tempDir, 'moltnet.json'),
      JSON.stringify(config, null, 2),
    );

    await expect(setupGitIdentity({ configDir: tempDir })).rejects.toThrow(
      'Git name and email are required',
    );
    await expect(readFile(join(tempDir, 'gitconfig'))).rejects.toThrow();
  });

  it.each([
    ['name', 'Trusted Agent\n[credential]\n\thelper = evil'],
    ['email', '[include]'],
  ])('rejects unsafe Git %s values', async (field, value) => {
    const config = createTestConfig({ withSsh: true });
    await writeFile(
      join(tempDir, 'moltnet.json'),
      JSON.stringify(config, null, 2),
    );

    await expect(
      setupGitIdentity({
        configDir: tempDir,
        ...(field === 'name' ? { name: value } : { email: value }),
      }),
    ).rejects.toThrow('unsafe in git config');
    await expect(readFile(join(tempDir, 'gitconfig'))).rejects.toThrow();
  });

  it('should generate gitconfig with correct INI sections', async () => {
    // Arrange
    const sshDir = join(tempDir, 'ssh');
    await mkdir(sshDir, { recursive: true });
    const publicKeyPath = join(sshDir, 'id_ed25519.pub');
    const publicKeySSH = toSSHPublicKey(TEST_PUBLIC_KEY);
    await writeFile(publicKeyPath, publicKeySSH);

    const config = createTestConfig({
      withSsh: true,
      sshPublicKeyPath: publicKeyPath,
      sshPrivateKeyPath: join(sshDir, 'id_ed25519'),
    });
    await writeFile(
      join(tempDir, 'moltnet.json'),
      JSON.stringify(config, null, 2),
    );

    // Act
    const gitconfigPath = await setupGitIdentity({
      configDir: tempDir,
    });

    // Assert
    const gitconfig = await readFile(gitconfigPath, 'utf-8');
    expect(gitconfig).toContain('[user]');
    expect(gitconfig).toContain('[gpg]');
    expect(gitconfig).toContain('\tformat = ssh');
    expect(gitconfig).toContain('[gpg "ssh"]');
    expect(gitconfig).toContain('[commit]');
    expect(gitconfig).toContain('\tgpgsign = true');
    expect(gitconfig).toContain('[tag]');
    expect(gitconfig).toContain(`\tsigningkey = ${publicKeyPath}`);
  });

  it('should generate allowed_signers with email and public key', async () => {
    // Arrange
    const sshDir = join(tempDir, 'ssh');
    await mkdir(sshDir, { recursive: true });
    const publicKeyPath = join(sshDir, 'id_ed25519.pub');
    const publicKeySSH = toSSHPublicKey(TEST_PUBLIC_KEY);
    await writeFile(publicKeyPath, publicKeySSH);

    const config = createTestConfig({
      withSsh: true,
      sshPublicKeyPath: publicKeyPath,
      sshPrivateKeyPath: join(sshDir, 'id_ed25519'),
    });
    await writeFile(
      join(tempDir, 'moltnet.json'),
      JSON.stringify(config, null, 2),
    );

    // Act
    await setupGitIdentity({ configDir: tempDir });

    // Assert
    const allowedSigners = await readFile(
      join(sshDir, 'allowed_signers'),
      'utf-8',
    );
    expect(allowedSigners).toContain(TEST_GIT_EMAIL);
    expect(allowedSigners).toContain('ssh-ed25519');
    expect(allowedSigners.trim()).toMatch(
      /^[^\s]+\s+ssh-ed25519\s+[A-Za-z0-9+/=]+$/,
    );
  });

  it('should update git section in moltnet.json', async () => {
    // Arrange
    const sshDir = join(tempDir, 'ssh');
    await mkdir(sshDir, { recursive: true });
    const publicKeyPath = join(sshDir, 'id_ed25519.pub');
    const publicKeySSH = toSSHPublicKey(TEST_PUBLIC_KEY);
    await writeFile(publicKeyPath, publicKeySSH);

    const config = createTestConfig({
      withSsh: true,
      sshPublicKeyPath: publicKeyPath,
      sshPrivateKeyPath: join(sshDir, 'id_ed25519'),
    });
    await writeFile(
      join(tempDir, 'moltnet.json'),
      JSON.stringify(config, null, 2),
    );

    // Act
    const gitconfigPath = await setupGitIdentity({
      configDir: tempDir,
    });

    // Assert
    const updatedConfig = JSON.parse(
      await readFile(join(tempDir, 'moltnet.json'), 'utf-8'),
    );
    expect(updatedConfig.git).toEqual({
      name: TEST_GIT_NAME,
      email: TEST_GIT_EMAIL,
      signing: true,
      config_path: gitconfigPath,
    });
  });

  it('should use custom name and email when provided', async () => {
    // Arrange
    const sshDir = join(tempDir, 'ssh');
    await mkdir(sshDir, { recursive: true });
    const publicKeyPath = join(sshDir, 'id_ed25519.pub');
    const publicKeySSH = toSSHPublicKey(TEST_PUBLIC_KEY);
    await writeFile(publicKeyPath, publicKeySSH);

    const config = createTestConfig({
      withSsh: true,
      sshPublicKeyPath: publicKeyPath,
      sshPrivateKeyPath: join(sshDir, 'id_ed25519'),
    });
    await writeFile(
      join(tempDir, 'moltnet.json'),
      JSON.stringify(config, null, 2),
    );

    const customName = 'my-custom-agent';
    const customEmail = 'custom@example.com';

    // Act
    const gitconfigPath = await setupGitIdentity({
      configDir: tempDir,
      name: customName,
      email: customEmail,
    });

    // Assert
    const gitconfig = await readFile(gitconfigPath, 'utf-8');
    expect(gitconfig).toContain(`\tname = ${customName}`);
    expect(gitconfig).toContain(`\temail = ${customEmail}`);

    const updatedConfig = JSON.parse(
      await readFile(join(tempDir, 'moltnet.json'), 'utf-8'),
    );
    expect(updatedConfig.git.name).toBe(customName);
    expect(updatedConfig.git.email).toBe(customEmail);
  });

  it('preserves configured authorship when no override is supplied', async () => {
    // Arrange
    const sshDir = join(tempDir, 'ssh');
    await mkdir(sshDir, { recursive: true });
    const publicKeyPath = join(sshDir, 'id_ed25519.pub');
    const publicKeySSH = toSSHPublicKey(TEST_PUBLIC_KEY);
    await writeFile(publicKeyPath, publicKeySSH);

    const config = createTestConfig({
      withSsh: true,
      sshPublicKeyPath: publicKeyPath,
      sshPrivateKeyPath: join(sshDir, 'id_ed25519'),
    });
    await writeFile(
      join(tempDir, 'moltnet.json'),
      JSON.stringify(config, null, 2),
    );

    // Act
    const gitconfigPath = await setupGitIdentity({
      configDir: tempDir,
    });

    // Assert
    const gitconfig = await readFile(gitconfigPath, 'utf-8');
    expect(gitconfig).toContain(`\tname = ${TEST_GIT_NAME}`);
    expect(gitconfig).toContain(`\temail = ${TEST_GIT_EMAIL}`);
  });
});
