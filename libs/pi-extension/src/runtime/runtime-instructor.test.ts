import { describe, expect, it } from 'vitest';

import {
  buildRuntimeInstructor,
  buildWorkspaceMountInstructions,
} from './runtime-instructor.js';

const ctx = {
  taskId: 'task-abc',
  taskType: 'fulfill_brief',
  attemptN: 1,
  diaryId: 'diary-xyz',
  agentName: 'legreffier',
  guestWorkspace: '/guest/workspace',
  correlationId: null,
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

  it('declares the diary discipline invariant with the task:* tag namespace', () => {
    const out = buildRuntimeInstructor(ctx);
    expect(out).toContain('moltnet_create_entry');
    expect(out).toContain('task:id:task-abc');
    expect(out).toContain('task:type:fulfill_brief');
    expect(out).toContain('task:attempt:1');
    // Old flat-prefix scheme must not leak into the prompt — agents
    // would otherwise produce conflicting freeform tags.
    expect(out).not.toMatch(/`task_type:/);
    expect(out).not.toMatch(/`task_attempt:/);
  });

  it('forbids the `moltnet entry` CLI inside a task (it bypasses task-tag auto-injection)', () => {
    // This is the #1094 P4 fix: entry `2c7109f3` (the failed
    // task `a3762f44` postmortem) was created via the moltnet CLI
    // from inside the VM, which hits the REST API directly and
    // bypasses the custom tool's auto-tag injection — leaving an
    // entry that `task:id:` filters can't find. The runtime
    // instructor must steer the agent away from that path.
    const out = buildRuntimeInstructor(ctx);
    expect(out).toMatch(/moltnet entry create/i);
    expect(out).toMatch(/bypass/i);
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

  it('requires additional git worktrees to stay inside the mounted workspace', () => {
    const out = buildRuntimeInstructor(ctx);
    expect(out).toContain('.worktrees/<name>');
    expect(out).toContain('outside the sandbox mount');
    expect(out).toContain('non-existent checkout');
  });

  it('mentions task:correlation:<id> when the task carries a correlationId', () => {
    const out = buildRuntimeInstructor({ ...ctx, correlationId: 'corr-xyz' });
    expect(out).toContain('task:correlation:corr-xyz');
  });

  it('omits the correlation tag when correlationId is null', () => {
    const out = buildRuntimeInstructor(ctx); // correlationId: null
    expect(out).not.toMatch(/task:correlation:/);
  });
});

describe('buildWorkspaceMountInstructions', () => {
  it('uses the active guest workspace path in the shared instruction block', () => {
    const out = buildWorkspaceMountInstructions('/mounted/repo');
    expect(out).toContain('Local files in /mounted/repo');
    expect(out).toContain('`/mounted/repo`');
    expect(out).toContain('.worktrees/<name>');
  });
});
