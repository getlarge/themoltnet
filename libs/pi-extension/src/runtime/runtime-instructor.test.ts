import { describe, expect, it } from 'vitest';

import {
  buildRuntimeKernel,
  buildWorkspaceMountInstructions,
} from './runtime-instructor.js';
import {
  buildRuntimePresetPrompt,
  getRuntimePreset,
} from './runtime-presets.js';

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
    const out = buildRuntimeKernel(ctx);
    expect(out).toContain('task-abc');
    expect(out).toContain('fulfill_brief');
    expect(out).toContain('diary-xyz');
    expect(out).toContain('legreffier');
  });

  it('declares gh authentication invariant with the credentials path pattern', () => {
    const out = buildRuntimeKernel(ctx);
    expect(out).toMatch(/GH_TOKEN=\$\(moltnet github token --credentials/);
    expect(out).toMatch(/GIT_CONFIG_GLOBAL/);
  });

  it('keeps behaviour out of the immutable kernel and in standard@v1', () => {
    const kernel = buildRuntimeKernel(ctx);
    const standard = buildRuntimePresetPrompt(
      getRuntimePreset('standard@v1'),
      ctx,
    );
    expect(kernel).not.toContain('Proactive memory and diary');
    expect(kernel).not.toContain('MoltNet-Diary: <id>');
    expect(standard).toContain('Proactive memory and diary');
    expect(standard).toContain('MoltNet-Diary: <id>');
  });

  it('frames skill packs as advisory and bounded', () => {
    const out = buildRuntimeKernel(ctx);
    expect(out).toMatch(/\/home\/agent\/\.skill\//);
    expect(out).toMatch(/advisory/i);
  });

  it('requires additional git worktrees to stay inside the mounted workspace', () => {
    const out = buildRuntimeKernel(ctx);
    expect(out).toContain('.worktrees/<name>');
    expect(out).toContain('outside the sandbox mount');
    expect(out).toContain('non-existent checkout');
  });

  it('does not turn correlation metadata into behavioural provenance prose', () => {
    const out = buildRuntimeKernel({ ...ctx, correlationId: 'corr-xyz' });
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
