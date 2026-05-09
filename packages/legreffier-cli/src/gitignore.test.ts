import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureMoltnetGitignored } from './gitignore.js';

const tmpRoot = join(tmpdir(), 'legreffier-gitignore-' + Date.now());

beforeEach(async () => {
  await mkdir(tmpRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('ensureMoltnetGitignored', () => {
  it('creates .gitignore with .moltnet/ when missing', async () => {
    expect(await ensureMoltnetGitignored(tmpRoot)).toBe(true);

    await expect(readFile(join(tmpRoot, '.gitignore'), 'utf-8')).resolves.toBe(
      '.moltnet/\n',
    );
  });

  it('appends .moltnet/ idempotently', async () => {
    await writeFile(join(tmpRoot, '.gitignore'), 'node_modules\n', 'utf-8');

    expect(await ensureMoltnetGitignored(tmpRoot)).toBe(true);
    expect(await ensureMoltnetGitignored(tmpRoot)).toBe(false);

    const content = await readFile(join(tmpRoot, '.gitignore'), 'utf-8');
    expect(content.match(/^\.moltnet\/?$/gm)).toHaveLength(1);
  });
});
