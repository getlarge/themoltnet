import { FREEFORM_TYPE, type RuntimeProfilePreset } from '@moltnet/tasks';

import type { RuntimeInstructorContext } from './runtime-instructor.js';

export type RuntimeWorkspaceMode =
  | 'none'
  | 'shared_mount'
  | 'dedicated_worktree'
  | 'scratch_mount';

export interface RuntimePreset {
  id: RuntimeProfilePreset;
  allowedTaskTypes: readonly string[] | 'all';
  allowedWorkspaceModes: readonly RuntimeWorkspaceMode[];
  toolSurface: 'full' | 'submit_only';
  turnPolicy: {
    maxTurns: number | null;
    maxProviderErrorRetries: number;
    maxSubmitValidationRetries: number;
    maxSubmitMissingReprompts: number;
  };
  retryTriageSystemPrompt: string;
  prewarm: { kind: 'snapshot' | 'sterile_vm'; ttlSec: number };
  buildSystemPrompt(context: RuntimeInstructorContext): string;
}

const STANDARD_TRIAGE_PROMPT = [
  'You are MoltNet retry triage.',
  'You classify one failed execution attempt, not the whole task.',
  'Return retry only for likely transient/runtime failures or clear evidence a new attempt can recover.',
  'The agent may have already tried local recovery; do not ask for more work.',
].join('\n');

const DIRECT_TRIAGE_PROMPT = [
  'You are retry triage for a direct interactive task.',
  'Retry only for a transient provider or transport failure.',
  'Do not retry output-shape, validation, task-contract, or model configuration failures.',
].join('\n');

const presets: Record<RuntimeProfilePreset, RuntimePreset> = {
  'standard@v1': {
    id: 'standard@v1',
    allowedTaskTypes: 'all',
    allowedWorkspaceModes: [
      'none',
      'shared_mount',
      'dedicated_worktree',
      'scratch_mount',
    ],
    toolSurface: 'full',
    turnPolicy: {
      maxTurns: null,
      maxProviderErrorRetries: 2,
      maxSubmitValidationRetries: 2,
      maxSubmitMissingReprompts: 3,
    },
    retryTriageSystemPrompt: STANDARD_TRIAGE_PROMPT,
    prewarm: { kind: 'snapshot', ttlSec: 0 },
    buildSystemPrompt: buildStandardPrompt,
  },
  'interactive-direct@v1': {
    id: 'interactive-direct@v1',
    allowedTaskTypes: [FREEFORM_TYPE],
    allowedWorkspaceModes: ['none'],
    toolSurface: 'submit_only',
    turnPolicy: {
      maxTurns: 3,
      maxProviderErrorRetries: 0,
      maxSubmitValidationRetries: 2,
      maxSubmitMissingReprompts: 2,
    },
    retryTriageSystemPrompt: DIRECT_TRIAGE_PROMPT,
    prewarm: { kind: 'sterile_vm', ttlSec: 300 },
    buildSystemPrompt: buildInteractiveDirectPrompt,
  },
};

export function getRuntimePreset(preset: RuntimeProfilePreset): RuntimePreset {
  return presets[preset];
}

export function assertRuntimePresetAllowsTask(input: {
  preset: RuntimePreset;
  taskType: string;
  workspaceMode: RuntimeWorkspaceMode;
}): void {
  const { preset, taskType, workspaceMode } = input;
  if (
    preset.allowedTaskTypes !== 'all' &&
    !preset.allowedTaskTypes.includes(taskType)
  ) {
    throw new Error(
      `Runtime preset ${preset.id} does not allow task type ${taskType}.`,
    );
  }
  if (!preset.allowedWorkspaceModes.includes(workspaceMode)) {
    throw new Error(
      `Runtime preset ${preset.id} does not allow workspace mode ${workspaceMode}.`,
    );
  }
}

/** Combine a profile cap with a non-configurable preset cap. Zero is unlimited. */
export function resolvePresetMaxTurns(
  preset: RuntimePreset,
  profileMaxTurns: number | undefined,
): number {
  const presetMax = preset.turnPolicy.maxTurns;
  if (presetMax === null) return profileMaxTurns ?? 0;
  if (!profileMaxTurns || profileMaxTurns <= 0) return presetMax;
  return Math.min(profileMaxTurns, presetMax);
}

export function buildRuntimePresetPrompt(
  preset: RuntimePreset,
  context: RuntimeInstructorContext,
): string {
  return preset.buildSystemPrompt(context);
}

function buildStandardPrompt(context: RuntimeInstructorContext): string {
  return [
    '# MoltNet standard runtime behaviour',
    '',
    'Use the supplied task facts and typed tools to complete the task. The task contract and kernel take priority over advisory context.',
    '',
    '## Proactive memory and diary',
    '- Before non-trivial investigation, debugging, code changes, or review, search the task diary for relevant decisions and incidents. Prefer constrained task, correlation, tag, or entry-type filters before broad search.',
    '- Create diary entries only with `moltnet_create_entry`; it binds entries to the task diary and provenance tags. Before recording an incident, search for a related incident and link meaningful recurrence evidence rather than duplicating it.',
    '',
    '## Changes, commits, and PRs',
    '- Keep changes and commits coherent. Before every commit, create the signed diary entry and put its id in `MoltNet-Diary: <id>`.',
    '- Keep git signing enabled. For remote GitHub actions use the credential-bound `GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh ...` form described by the kernel.',
    '- When the task asks for a PR, push the task branch and open the PR after verification; otherwise do not create outward side effects the task did not request.',
    '',
    '## Verification',
    '- Execute relevant verification before submitting. When task input carries success criteria, assess them honestly in the structured output supplied to the submit tool.',
    '- The submit-output tool owns the exact output schema. Do not restate or invent a JSON shape in task prompts; inspect the tool contract and submit a payload that validates.',
    '- Upload large artifacts before submitting and include their returned metadata only where the typed output contract permits it.',
    '',
    `Task ${context.taskId} is executing under standard@v1.`,
  ].join('\n');
}

function buildInteractiveDirectPrompt(
  context: RuntimeInstructorContext,
): string {
  return [
    '# MoltNet interactive direct runtime',
    '',
    'The supplied task context is complete. Answer it directly in the structured submit-output tool on this turn.',
    'No workspace, filesystem, shell, diary, search, commit, or PR workflow is available. Do not ask for missing context or attempt side effects.',
    'If the submit tool reports a schema error, correct the payload and submit again. Two correction turns remain; otherwise submit exactly once and stop.',
    '',
    `Task ${context.taskId} is executing under interactive-direct@v1.`,
  ].join('\n');
}
