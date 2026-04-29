import { describe, expect, it } from 'vitest';

import { buildRuntimeInstructor } from './runtime-instructor.js';

const ctx = {
  taskId: 'task-abc',
  taskType: 'fulfill_brief',
  attemptN: 1,
  diaryId: 'diary-xyz',
  agentName: 'legreffier',
};

describe('runtime instructor', () => {
  it('embeds the task context fields verbatim', () => {
    const out = buildRuntimeInstructor(ctx);
    expect(out).toContain('task-abc');
    expect(out).toContain('fulfill_brief');
    expect(out).toContain('diary-xyz');
    expect(out).toContain('legreffier');
  });

  it('declares gh authentication invariant with the credentials path pattern', () => {
    const out = buildRuntimeInstructor(ctx);
    expect(out).toMatch(/GH_TOKEN=\$\(moltnet github token --credentials/);
    expect(out).toMatch(/GIT_CONFIG_GLOBAL/);
  });

  it('declares the diary discipline invariant', () => {
    const out = buildRuntimeInstructor(ctx);
    expect(out).toContain('moltnet_create_entry');
    expect(out).toContain('task:task-abc');
    expect(out).toContain('task_type:fulfill_brief');
    expect(out).toContain('task_attempt:1');
  });

  it('declares the accountable-commit trailer shape', () => {
    const out = buildRuntimeInstructor(ctx);
    expect(out).toMatch(/MoltNet-Diary: <id>/);
  });

  it('frames skill packs as advisory and bounded', () => {
    const out = buildRuntimeInstructor(ctx);
    expect(out).toMatch(/\/home\/agent\/\.skill\//);
    expect(out).toMatch(/advisory/i);
  });
});
