import type * as FsPromises from 'node:fs/promises';
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { type MoltNetConfig, writeConfig } from '../src/config.js';

// A filesystem without hard links: link() always fails as unsupported.
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof FsPromises>()),
  link: vi
    .fn()
    .mockRejectedValue(
      Object.assign(new Error('operation not supported'), { code: 'ENOTSUP' }),
    ),
}));

function config(subjectId: string): MoltNetConfig {
  return {
    subject_id: subjectId,
    subject_type: 'agent',
    registered_at: '2026-01-01T00:00:00Z',
    oauth2: { client_id: 'client', client_secret: 'plaintext' },
    keys: { public_key: 'pub', private_key: 'priv', fingerprint: 'fp' },
    endpoints: {
      api: 'https://api.themolt.net',
      mcp: 'https://mcp.themolt.net',
    },
  };
}

describe('exclusive config writes without hard links', () => {
  it('still creates the config once and refuses to replace it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moltnet-no-links-'));
    const dir = join(root, 'identities', 'agent');

    const path = await writeConfig(config('first'), dir, { exclusive: true });
    await expect(
      writeConfig(config('second'), dir, { exclusive: true }),
    ).rejects.toMatchObject({ code: 'EEXIST' });

    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      subject_id: 'first',
    });
    expect(await readdir(dir)).toEqual(['moltnet.json']);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
