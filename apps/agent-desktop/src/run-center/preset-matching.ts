import type { AgentServerRun, RunPreset } from './types.js';

/**
 * Null follows current defaults; legacy snapshots never become overrides.
 * Project fields are compared with what the run requested, never with what it
 * resolved to, so a General preset never labels a project run or the reverse.
 */
export function findRunPreset(
  presets: RunPreset[],
  run: AgentServerRun,
): RunPreset | undefined {
  return presets.find(
    (preset) =>
      preset.agent === run.agent &&
      preset.teamId === run.teamId &&
      (preset.version !== 2 ||
        preset.diaryId === null ||
        preset.diaryId === (run.diaryId ?? null)) &&
      (preset.projectId ?? null) === (run.projectId ?? null) &&
      (preset.location ?? null) === (run.location ?? null) &&
      (preset.source ?? null) === (run.source ?? null) &&
      (preset.strategy ?? null) === (run.strategy ?? null) &&
      (preset.mode ?? 'poll') === run.mode &&
      (preset.correlationId ?? null) === (run.correlationId ?? null) &&
      JSON.stringify([...(preset.diaryIds ?? [])].sort()) ===
        JSON.stringify([...(run.diaryIds ?? [])].sort()) &&
      (preset.pollIntervalMs ?? null) === (run.pollIntervalMs ?? null) &&
      (preset.maxPollIntervalMs ?? null) === (run.maxPollIntervalMs ?? null) &&
      (preset.waitForFirstTaskSec ?? null) ===
        (run.waitForFirstTaskSec ?? null) &&
      (preset.waitAfterTaskSec ?? null) === (run.waitAfterTaskSec ?? null) &&
      JSON.stringify(preset.profileIds) === JSON.stringify(run.profiles) &&
      JSON.stringify([...preset.taskTypes].sort()) ===
        JSON.stringify([...run.taskTypes].sort()),
  );
}
