import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { exchangeManifestCode, writePem } from './github.js';

const TEST_SLUG = 'test-github-' + Math.random().toString(36).slice(2);
const configDir = join(homedir(), '.config', 'moltnet', TEST_SLUG);

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('exchangeManifestCode', () => {
  it('returns credentials on success', async () => {
    const mockData = {
      id: 12345,
      slug: 'my-app',
      pem: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----',
      client_id: 'Iv1.abc123',
      client_secret: 'secret456',
    };
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => mockData,
    }));

    const creds = await exchangeManifestCode('test-code');
    expect(creds.appId).toBe('12345');
    expect(creds.appSlug).toBe('my-app');
    expect(creds.clientId).toBe('Iv1.abc123');
    expect(creds.clientSecret).toBe('secret456');
    expect(creds.pem).toContain('BEGIN RSA PRIVATE KEY');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 422,
      text: async () => 'code already used',
    }));

    await expect(exchangeManifestCode('bad-code')).rejects.toThrow(
      'GitHub code exchange failed (422)',
    );
  });
});

describe('writePem', () => {
  beforeEach(async () => {
    await mkdir(configDir, { recursive: true });
  });

  it('writes PEM file with 0o600 permissions', async () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n';
    const path = await writePem(pem, 'my-app', configDir);

    const content = await readFile(path, 'utf-8');
    expect(content).toBe(pem);
    expect(path).toContain('my-app.pem');
  });

  it('creates directory if missing', async () => {
    await rm(configDir, { recursive: true, force: true });
    const pem = 'fake pem';
    const path = await writePem(pem, 'new-app', configDir);
    const content = await readFile(path, 'utf-8');
    expect(content).toBe(pem);
  });
});
