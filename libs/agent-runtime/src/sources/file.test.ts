import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FormatRegistry } from '@sinclair/typebox';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeFulfillBriefTask } from '../test-fixtures.js';
import { FileTaskSource } from './file.js';

if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (v) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v,
    ),
  );
}
if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set('date-time', (v) => !Number.isNaN(Date.parse(v)));
}

describe('FileTaskSource', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fts-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (task: unknown): string => {
    const p = join(dir, 'task.json');
    writeFileSync(p, JSON.stringify(task), 'utf8');
    return p;
  };

  it('yields a single Task then null', async () => {
    const task = makeFulfillBriefTask();
    const src = new FileTaskSource(write(task));
    expect(await src.claim()).toMatchObject({ id: task.id });
    expect(await src.claim()).toBeNull();
    await src.close();
  });

  it('yields array tasks in order', async () => {
    const a = makeFulfillBriefTask({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const b = makeFulfillBriefTask({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    const src = new FileTaskSource(write([a, b]));
    expect((await src.claim())?.id).toBe(a.id);
    expect((await src.claim())?.id).toBe(b.id);
    expect(await src.claim()).toBeNull();
  });

  it('rejects malformed JSON', async () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json', 'utf8');
    const src = new FileTaskSource(p);
    await expect(src.claim()).rejects.toThrow(/invalid JSON/);
  });

  it('rejects a Task that fails schema validation', async () => {
    const task = { ...makeFulfillBriefTask(), id: 'not-a-uuid' };
    const src = new FileTaskSource(write(task));
    await expect(src.claim()).rejects.toThrow(/does not match Task schema/);
  });

  it('rejects an unknown task_type', async () => {
    const task = makeFulfillBriefTask({ task_type: 'unknown_type' });
    const src = new FileTaskSource(write(task));
    await expect(src.claim()).rejects.toThrow(/unknown task_type/);
  });

  it('rejects a well-formed Task whose input fails the type schema', async () => {
    const task = makeFulfillBriefTask({
      input: { brief: '', title: 'x' } as unknown as Record<string, unknown>,
    });
    const src = new FileTaskSource(write(task));
    await expect(src.claim()).rejects.toThrow(/input/);
  });
});
