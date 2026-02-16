import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { credentialHelper } from '../src/credential-helper.js';

describe('credentialHelper', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'moltnet-cred-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should throw when no config found', async () => {
    // Arrange — empty temp dir, no moltnet.json

    // Act & Assert
    await expect(credentialHelper(tempDir)).rejects.toThrow('No config found');
  });

  it('should throw when no github section in config', async () => {
    // Arrange — config without github section
    const config = {
      identity_id: 'test-agent',
      registered_at: '2025-01-01T00:00:00.000Z',
      oauth2: {
        client_id: 'test-client',
        client_secret: 'test-secret',
      },
      keys: {
        public_key: 'ed25519:test',
        private_key: 'test',
        fingerprint: 'test',
      },
      endpoints: {
        api: 'https://api.themolt.net',
        mcp: 'https://mcp.themolt.net/mcp',
      },
    };
    await writeFile(
      join(tempDir, 'moltnet.json'),
      JSON.stringify(config, null, 2),
    );

    // Act & Assert
    await expect(credentialHelper(tempDir)).rejects.toThrow(
      'GitHub App not configured',
    );
  });
});
