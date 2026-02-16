import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MoltNetConfig } from '../src/credentials.js';

// Mock homedir so getConfigDir() uses our temp dir.
vi.mock('node:os', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown> & {
    homedir: () => string;
  };
  return {
    ...original,
    homedir: vi.fn(() => original.homedir()),
  };
});

import { homedir } from 'node:os';

const mockedHomedir = vi.mocked(homedir);

describe('credentials / config', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'moltnet-test-'));
    mockedHomedir.mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function configDir(): string {
    return join(tempDir, '.config', 'moltnet');
  }

  const sampleConfig: MoltNetConfig = {
    identity_id: 'uuid-123',
    registered_at: '2026-01-01T00:00:00.000Z',
    oauth2: {
      client_id: 'client-id',
      client_secret: 'client-secret',
    },
    keys: {
      public_key: 'ed25519:dGVzdA==',
      private_key: 'cHJpdmF0ZQ==',
      fingerprint: 'ABCD-1234-EF56-7890',
    },
    endpoints: {
      api: 'https://api.themolt.net',
      mcp: 'https://mcp.themolt.net/mcp',
    },
  };

  describe('getConfigPath', () => {
    it('returns path ending in moltnet.json', async () => {
      const { getConfigPath } = await import('../src/credentials.js');
      const p = getConfigPath();
      expect(p).toMatch(/moltnet\.json$/);
      expect(p).toBe(join(configDir(), 'moltnet.json'));
    });
  });

  describe('readConfig', () => {
    it('reads moltnet.json when it exists', async () => {
      // Arrange
      const dir = configDir();
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'moltnet.json'),
        JSON.stringify(sampleConfig, null, 2),
      );

      // Act
      const { readConfig } = await import('../src/credentials.js');
      const result = await readConfig();

      // Assert
      expect(result).not.toBeNull();
      expect(result!.identity_id).toBe('uuid-123');
      expect(result!.oauth2.client_id).toBe('client-id');
    });

    it('falls back to credentials.json when moltnet.json absent, emits deprecation warning', async () => {
      // Arrange
      const dir = configDir();
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'credentials.json'),
        JSON.stringify(sampleConfig, null, 2),
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Act
      const { readConfig } = await import('../src/credentials.js');
      const result = await readConfig();

      // Assert
      expect(result).not.toBeNull();
      expect(result!.identity_id).toBe('uuid-123');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('credentials.json'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('deprecated'),
      );
    });

    it('prefers moltnet.json when both exist', async () => {
      // Arrange
      const dir = configDir();
      await mkdir(dir, { recursive: true });

      const oldConfig = { ...sampleConfig, identity_id: 'old-uuid' };
      const newConfig = { ...sampleConfig, identity_id: 'new-uuid' };

      await writeFile(
        join(dir, 'credentials.json'),
        JSON.stringify(oldConfig, null, 2),
      );
      await writeFile(
        join(dir, 'moltnet.json'),
        JSON.stringify(newConfig, null, 2),
      );

      // Act
      const { readConfig } = await import('../src/credentials.js');
      const result = await readConfig();

      // Assert
      expect(result).not.toBeNull();
      expect(result!.identity_id).toBe('new-uuid');
    });

    it('returns null when neither file exists', async () => {
      const { readConfig } = await import('../src/credentials.js');
      const result = await readConfig();
      expect(result).toBeNull();
    });
  });

  describe('writeConfig', () => {
    it('always writes to moltnet.json', async () => {
      // Arrange & Act
      const { writeConfig } = await import('../src/credentials.js');
      const path = await writeConfig(sampleConfig);

      // Assert
      expect(path).toBe(join(configDir(), 'moltnet.json'));
      const content = await readFile(path, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.identity_id).toBe('uuid-123');
    });

    it('sets file permissions to 0o600', async () => {
      const { writeConfig } = await import('../src/credentials.js');
      const path = await writeConfig(sampleConfig);

      const info = await stat(path);
      expect(info.mode & 0o777).toBe(0o600);
    });
  });

  describe('optional sections round-trip', () => {
    it('ssh, git, github sections round-trip correctly', async () => {
      // Arrange
      const configWithSections: MoltNetConfig = {
        ...sampleConfig,
        ssh: {
          private_key_path: '/home/agent/.config/moltnet/ssh/id_ed25519',
          public_key_path: '/home/agent/.config/moltnet/ssh/id_ed25519.pub',
        },
        git: {
          name: 'agent-001',
          email: 'agent-001@themolt.net',
          signing: true,
          config_path: '/home/agent/.gitconfig',
        },
        github: {
          app_id: 'app-123',
          installation_id: 'install-456',
          private_key_path: '/home/agent/.config/moltnet/github/key.pem',
        },
      };

      // Act
      const { writeConfig, readConfig } = await import('../src/credentials.js');
      await writeConfig(configWithSections);
      const result = await readConfig();

      // Assert
      expect(result).not.toBeNull();
      expect(result!.ssh).toEqual(configWithSections.ssh);
      expect(result!.git).toEqual(configWithSections.git);
      expect(result!.github).toEqual(configWithSections.github);
    });
  });

  describe('updateConfigSection', () => {
    it('merges into existing config', async () => {
      // Arrange
      const { writeConfig, updateConfigSection, readConfig } =
        await import('../src/credentials.js');
      await writeConfig(sampleConfig);

      // Act
      await updateConfigSection('ssh', {
        private_key_path: '/path/to/priv',
        public_key_path: '/path/to/pub',
      });

      // Assert
      const result = await readConfig();
      expect(result).not.toBeNull();
      expect(result!.ssh).toEqual({
        private_key_path: '/path/to/priv',
        public_key_path: '/path/to/pub',
      });
      // Original fields preserved
      expect(result!.identity_id).toBe('uuid-123');
    });
  });

  describe('backwards compatibility', () => {
    it('readCredentials still works as alias', async () => {
      // Arrange
      const dir = configDir();
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'moltnet.json'),
        JSON.stringify(sampleConfig, null, 2),
      );

      // Act
      const { readCredentials } = await import('../src/credentials.js');
      const result = await readCredentials();

      // Assert
      expect(result).not.toBeNull();
      expect(result!.identity_id).toBe('uuid-123');
    });

    it('getCredentialsPath returns path ending in moltnet.json', async () => {
      const { getCredentialsPath } = await import('../src/credentials.js');
      const p = getCredentialsPath();
      expect(p).toMatch(/moltnet\.json$/);
    });
  });
});
