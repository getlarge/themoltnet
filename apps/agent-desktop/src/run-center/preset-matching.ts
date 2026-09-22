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
      JSON.stringify(preset.profileIds) === JSON.stringify(run.profiles) &&
      JSON.stringify([...preset.taskTypes].sort()) ===
        JSON.stringify([...run.taskTypes].sort()),
  );
}
