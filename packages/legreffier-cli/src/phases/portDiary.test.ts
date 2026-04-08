import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSourceDiaryId, runPortDiaryPhase } from './portDiary.js';

const tmpRoot = join(tmpdir(), 'legreffier-port-diary-' + Date.now());

async function seedEnv(dir: string, lines: string[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'env'), lines.join('\n') + '\n', 'utf-8');
}

beforeEach(async () => {
  await mkdir(tmpRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('readSourceDiaryId', () => {
  it('returns the diary id when present', async () => {
    const dir = join(tmpRoot, 'src1');
    await seedEnv(dir, [
      "GIT_CONFIG_GLOBAL='.moltnet/legreffier/gitconfig'",
      "MOLTNET_DIARY_ID='abc-123'",
    ]);
    expect(await readSourceDiaryId(dir)).toBe('abc-123');
  });

  it('returns null when env file missing', async () => {
    const dir = join(tmpRoot, 'src-missing');
    await mkdir(dir, { recursive: true });
    expect(await readSourceDiaryId(dir)).toBeNull();
  });

  it('returns null when key absent', async () => {
    const dir = join(tmpRoot, 'src-nokey');
    await seedEnv(dir, ["LEGREFFIER_CLIENT_ID='x'"]);
    expect(await readSourceDiaryId(dir)).toBeNull();
  });
});

describe('runPortDiaryPhase', () => {
  it('reuse: writes source diary id after GIT_CONFIG_GLOBAL', async () => {
    const dir = join(tmpRoot, 'reuse');
    await seedEnv(dir, [
      "LEGREFFIER_CLIENT_ID='cid'",
      "GIT_CONFIG_GLOBAL='.moltnet/legreffier/gitconfig'",
      "MOLTNET_AGENT_NAME='legreffier'",
    ]);

    const result = await runPortDiaryPhase({
      targetDir: dir,
      mode: 'reuse',
      sourceDiaryId: 'abc-123',
    });

    expect(result.mode).toBe('reuse');
    expect(result.diaryId).toBe('abc-123');
    expect(result.modified).toBe(true);

    const env = await readFile(join(dir, 'env'), 'utf-8');
    expect(env).toContain("MOLTNET_DIARY_ID='abc-123'");
    // Positioned after GIT_CONFIG_GLOBAL
    const lines = env.split('\n');
    const gitIdx = lines.findIndex((l) => l.startsWith('GIT_CONFIG_GLOBAL='));
    const diaryIdx = lines.findIndex((l) => l.startsWith('MOLTNET_DIARY_ID='));
    expect(diaryIdx).toBe(gitIdx + 1);
  });

  it('reuse: no-op when sourceDiaryId is null', async () => {
    const dir = join(tmpRoot, 'reuse-null');
    await seedEnv(dir, ["LEGREFFIER_CLIENT_ID='cid'"]);

    const result = await runPortDiaryPhase({
      targetDir: dir,
      mode: 'reuse',
      sourceDiaryId: null,
    });

    expect(result.diaryId).toBeNull();
    expect(result.modified).toBe(false);
  });

  it('new: strips existing MOLTNET_DIARY_ID', async () => {
    const dir = join(tmpRoot, 'new');
    await seedEnv(dir, [
      "LEGREFFIER_CLIENT_ID='cid'",
      "MOLTNET_DIARY_ID='stale-uuid'",
      "GIT_CONFIG_GLOBAL='.moltnet/legreffier/gitconfig'",
    ]);

    const result = await runPortDiaryPhase({
      targetDir: dir,
      mode: 'new',
      sourceDiaryId: 'ignored',
    });

    expect(result.mode).toBe('new');
    expect(result.diaryId).toBeNull();
    expect(result.modified).toBe(true);

    const env = await readFile(join(dir, 'env'), 'utf-8');
    expect(env).not.toContain('MOLTNET_DIARY_ID');
  });

  it('skip: does not touch env file', async () => {
    const dir = join(tmpRoot, 'skip');
    const originalLines = [
      "LEGREFFIER_CLIENT_ID='cid'",
      "MOLTNET_DIARY_ID='keep-me'",
    ];
    await seedEnv(dir, originalLines);
    const before = await readFile(join(dir, 'env'), 'utf-8');

    const result = await runPortDiaryPhase({
      targetDir: dir,
      mode: 'skip',
      sourceDiaryId: 'other',
    });

    expect(result.modified).toBe(false);
    const after = await readFile(join(dir, 'env'), 'utf-8');
    expect(after).toBe(before);
  });
});
