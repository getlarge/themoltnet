import type { AgentServerRun, RunPreset } from './types.js';
/** Null follows current defaults; legacy snapshots never become overrides. */
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
      JSON.stringify(preset.profileIds) === JSON.stringify(run.profiles) &&
      JSON.stringify([...preset.taskTypes].sort()) ===
        JSON.stringify([...run.taskTypes].sort()),
  );
}
