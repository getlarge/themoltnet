import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appendAuthorshipVars, resolveHumanGitIdentity } from './env-file.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const tmpDir = join(
  tmpdir(),
  'env-file-test-' + Math.random().toString(36).slice(2),
);

beforeEach(async () => {
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('resolveHumanGitIdentity', () => {
  it('returns "Name <email>" when both are set', () => {
    vi.mocked(execFileSync)
      .mockReturnValueOnce('Alice\n')
      .mockReturnValueOnce('alice@example.com\n');

    expect(resolveHumanGitIdentity()).toBe('Alice <alice@example.com>');
  });

  it('returns null when name is empty', () => {
    vi.mocked(execFileSync)
      .mockReturnValueOnce('\n')
      .mockReturnValueOnce('alice@example.com\n');

    expect(resolveHumanGitIdentity()).toBeNull();
  });

  it('returns null when git config fails', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('git config not found');
    });

    expect(resolveHumanGitIdentity()).toBeNull();
  });

  it('passes GIT_CONFIG_GLOBAL as undefined to read human config', () => {
    vi.mocked(execFileSync)
      .mockReturnValueOnce('Alice\n')
      .mockReturnValueOnce('alice@example.com\n');

    resolveHumanGitIdentity();

    const calls = vi.mocked(execFileSync).mock.calls;
    for (const call of calls) {
      const opts = call[2] as { env?: Record<string, unknown> };
      expect(opts.env?.GIT_CONFIG_GLOBAL).toBeUndefined();
    }
  });
});

describe('appendAuthorshipVars', () => {
  it('appends human identity to existing env file', async () => {
    const envPath = join(tmpDir, 'env');
    await writeFile(envPath, 'EXISTING_VAR=value\n', 'utf-8');

    await appendAuthorshipVars(tmpDir, 'Alice <alice@example.com>');

    const content = await readFile(envPath, 'utf-8');
    expect(content).toContain(
      "MOLTNET_HUMAN_GIT_IDENTITY='Alice <alice@example.com>'",
    );
    expect(content).toContain('EXISTING_VAR=value');
  });

  it('appends both identity and authorship', async () => {
    const envPath = join(tmpDir, 'env');
    await writeFile(envPath, 'FOO=bar\n', 'utf-8');

    await appendAuthorshipVars(tmpDir, 'Bob <bob@example.com>', 'coauthor');

    const content = await readFile(envPath, 'utf-8');
    expect(content).toContain(
      "MOLTNET_HUMAN_GIT_IDENTITY='Bob <bob@example.com>'",
    );
    expect(content).toContain("MOLTNET_COMMIT_AUTHORSHIP='coauthor'");
  });

  it('does not duplicate vars already present', async () => {
    const envPath = join(tmpDir, 'env');
    await writeFile(
      envPath,
      "MOLTNET_HUMAN_GIT_IDENTITY='Alice <alice@example.com>'\n",
      'utf-8',
    );

    await appendAuthorshipVars(tmpDir, 'Alice <alice@example.com>');

    const content = await readFile(envPath, 'utf-8');
    const matches = content.match(/MOLTNET_HUMAN_GIT_IDENTITY=/g);
    expect(matches).toHaveLength(1);
  });

  it('does not match vars in comments', async () => {
    const envPath = join(tmpDir, 'env');
    await writeFile(
      envPath,
      '# MOLTNET_HUMAN_GIT_IDENTITY=old value\nFOO=bar\n',
      'utf-8',
    );

    await appendAuthorshipVars(tmpDir, 'Alice <alice@example.com>');

    const content = await readFile(envPath, 'utf-8');
    const matches = content.match(/^MOLTNET_HUMAN_GIT_IDENTITY=/gm);
    expect(matches).toHaveLength(1);
  });

  it('does nothing when env file is missing', async () => {
    // No env file in tmpDir — should not throw
    await expect(
      appendAuthorshipVars(tmpDir, 'Alice <alice@example.com>'),
    ).resolves.toBeUndefined();
  });

  it('does nothing when both args are null/undefined', async () => {
    const envPath = join(tmpDir, 'env');
    await writeFile(envPath, 'FOO=bar\n', 'utf-8');

    await appendAuthorshipVars(tmpDir, null, undefined);

    const content = await readFile(envPath, 'utf-8');
    expect(content).toBe('FOO=bar\n');
  });
});
