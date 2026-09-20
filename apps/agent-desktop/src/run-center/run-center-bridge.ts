/**
 * Renderer half of the desktop-control client.
 *
 * Every call here crosses into native code, which applies the process-scoped
 * grant on the way out. The renderer names an identity or a run and receives
 * JSON; it never holds a credential it could leak through a bug, an extension,
 * or a devtools session.
 *
 * Presets are the exception: they are per-machine UI state the app owns, so
 * they live in the renderer's own storage rather than on the control API.
 */
import { invoke } from '@tauri-apps/api/core';

import type {
  AgentServerCatalogue,
  AgentServerRun,
  RunCenterActions,
  RunPreset,
  SavePresetInput,
  StartRunInput,
} from './types.js';

const PRESETS_KEY = 'moltnet.run-presets.v1';

/** Presets survive a reload but never leave this machine. */
function readPresets(): RunPreset[] {
  try {
    const raw = window.localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as RunPreset[]) : [];
  } catch {
    // Corrupt or unavailable storage must not take the Runs view down.
    return [];
  }
}

function writePresets(presets: RunPreset[]): void {
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Non-fatal: the run still starts, the preset just is not remembered.
  }
}

export function listPresets(): RunPreset[] {
  return readPresets();
}

export const runCenterActions: RunCenterActions = {
  enrollTeam: (identity, request) =>
    invoke('desktop_enroll_team', { identity, request }),
  createIdentity: (name, invitation) =>
    invoke('desktop_create_identity', { name, invitation }),
  openTeamInvites: (teamId) => invoke('desktop_team_invites', { teamId }),
  catalogue: (identity) =>
    invoke<AgentServerCatalogue>('desktop_catalogue', { identity }),

  startRun: (input: StartRunInput) =>
    invoke<AgentServerRun>('desktop_start_run', {
      spec: {
        agent: input.agent,
        teamId: input.teamId,
        ...(input.diaryId ? { diaryId: input.diaryId } : {}),
        profiles: input.profiles,
        taskTypes: input.taskTypes,
        mode: input.mode,
      },
    }),

  stopRun: async (runId) => {
    await invoke('desktop_stop_run', { runId });
  },

  savePreset: async (input: SavePresetInput) => {
    const presets = readPresets();
    const existing = input.id
      ? presets.find((preset) => preset.id === input.id)
      : undefined;
    const preset: RunPreset = {
      id: existing?.id ?? crypto.randomUUID(),
      name: input.name,
      agent: input.agent,
      teamId: input.teamId,
      diaryId: input.diaryId,
      profileIds: input.profileIds,
      taskTypes: input.taskTypes,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastUsedAt: existing?.lastUsedAt ?? null,
    };
    writePresets(
      existing
        ? presets.map((entry) => (entry.id === preset.id ? preset : entry))
        : [...presets, preset],
    );
  },

  deletePreset: async (presetId) => {
    writePresets(readPresets().filter((preset) => preset.id !== presetId));
  },

  subscribeRunLogs: (runId, onLines) => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    const poll = async (current: number) => {
      if (stopped || document.visibilityState === 'hidden') return;
      try {
        const snapshot = await invoke<{ lines: string[] }>('desktop_run_logs', {
          runId,
        });
        if (!stopped && current === generation) onLines(snapshot.lines);
      } catch {
        if (!stopped && current === generation)
          onLines(['Log output is unavailable. Check the Server view.']);
      }
      if (!stopped && current === generation)
        timer = setTimeout(() => void poll(current), 3_000);
    };
    const visible = () => {
      clearTimeout(timer);
      void poll(++generation);
    };
    document.addEventListener('visibilitychange', visible);
    visible();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  },
};
