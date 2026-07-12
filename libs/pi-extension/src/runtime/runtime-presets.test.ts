import { describe, expect, it } from 'vitest';

import {
  assertRuntimePresetAllowsTask,
  buildRuntimePresetPrompt,
  getRuntimePreset,
  resolvePresetMaxTurns,
} from './runtime-presets.js';

const context = {
  taskId: 'task-1',
  taskType: 'freeform',
  attemptN: 1,
  diaryId: 'diary-1',
  agentName: 'agent-1',
  guestWorkspace: '/workspace',
  correlationId: null,
};

describe('runtime presets', () => {
  it('keeps standard@v1 behaviour compatible with the full task surface', () => {
    const preset = getRuntimePreset('standard@v1');
    expect(preset.allowedTaskTypes).toBe('all');
    expect(preset.toolSurface).toBe('full');
    expect(buildRuntimePresetPrompt(preset, context)).toContain(
      'Proactive memory and diary',
    );
  });

  it('limits interactive-direct@v1 to direct freeform submit recovery', () => {
    const preset = getRuntimePreset('interactive-direct@v1');
    expect(preset.toolSurface).toBe('submit_only');
    expect(preset.turnPolicy.maxTurns).toBe(3);
    expect(preset.turnPolicy.maxProviderErrorRetries).toBe(0);
    expect(preset.prewarm).toEqual({ kind: 'sterile_vm', ttlSec: 300 });
    expect(() =>
      assertRuntimePresetAllowsTask({
        preset,
        taskType: 'fulfill_brief',
        workspaceMode: 'none',
      }),
    ).toThrow(/does not allow task type/);
    expect(() =>
      assertRuntimePresetAllowsTask({
        preset,
        taskType: 'freeform',
        workspaceMode: 'dedicated_worktree',
      }),
    ).toThrow(/does not allow workspace mode/);
    expect(resolvePresetMaxTurns(preset, 0)).toBe(3);
    expect(resolvePresetMaxTurns(preset, 2)).toBe(2);
  });
});
