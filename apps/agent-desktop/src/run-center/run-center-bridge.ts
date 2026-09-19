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
  AgentServerProvider,
  AgentServerRun,
  AgentServerSubscription,
  AgentServerSubscriptionLogin,
  ProviderActions,
  RunCenterActions,
  RunPreset,
  SavePresetInput,
  StartRunInput,
  SubscriptionActions,
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

/** Provider credentials. The key crosses to native code and no further. */
export const providerActions: ProviderActions = {
  putProvider: (providerId, config) =>
    invoke<AgentServerProvider>('desktop_put_provider', {
      providerId,
      config,
    }),
  deleteProvider: async (providerId) => {
    await invoke('desktop_delete_provider', { providerId });
  },
};

/** Subscription sign-in. The provider page opens natively, not from here. */
export const subscriptionActions: SubscriptionActions = {
  startLogin: (providerId) =>
    invoke<AgentServerSubscriptionLogin>('desktop_start_subscription_login', {
      providerId,
    }),
  loginStatus: (providerId) =>
    invoke<AgentServerSubscriptionLogin>('desktop_subscription_login_status', {
      providerId,
    }),
  cancelLogin: async (providerId) => {
    await invoke('desktop_cancel_subscription_login', { providerId });
  },
  openSignIn: async (url) => {
    await invoke('desktop_open_sign_in', { url });
  },
};

export function listSubscriptions(): Promise<AgentServerSubscription[]> {
  return invoke<AgentServerSubscription[]>('desktop_subscriptions');
}

export function listProviders(): Promise<Record<string, AgentServerProvider>> {
  return invoke<Record<string, AgentServerProvider>>('desktop_providers');
}

export const runCenterActions: RunCenterActions = {
  signInOperator: () => invoke('desktop_operator_sign_in'),
  enrollTeam: (identity, request) =>
    invoke('desktop_enroll_team', { identity, request }),
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

  subscribeRunLogs: (runId, onLine) => {
    // Streaming is not wired yet; the detail view falls back to the log file
    // the Server panel already exposes. Kept in the contract so the view does
    // not change shape when SSE lands.
    void runId;
    void onLine;
    return () => undefined;
  },
};
