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
  ProjectActions,
  ProjectLocation,
  ProviderActions,
  RunCenterActions,
  RunPreset,
  SavePresetInput,
  StartRunInput,
  SubscriptionActions,
} from './types.js';

const PRESETS_KEY = 'moltnet.run-presets.v1';

async function presetStorageKey(): Promise<string> {
  const settings = await invoke<{ storageScope?: string }>(
    'desktop_preset_storage_scope',
  );
  if (typeof settings.storageScope !== 'string') {
    throw new Error(
      'Restart an updated Desktop app to access presets for this environment.',
    );
  }
  return settings.storageScope
    ? `${PRESETS_KEY}:${settings.storageScope}`
    : PRESETS_KEY;
}

/** Presets survive a reload but never leave this machine. */
function readPresets(key: string): RunPreset[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as RunPreset[]) : [];
  } catch {
    // Corrupt or unavailable storage must not take the Runs view down.
    return [];
  }
}

function writePresets(key: string, presets: RunPreset[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(presets));
  } catch {
    throw new Error(
      'The preset could not be saved. Check available storage and try again.',
    );
  }
}

export async function listPresets(): Promise<RunPreset[]> {
  return readPresets(await presetStorageKey());
}

/** Provider credentials. The key crosses to native code and no further. */
export const providerActions: ProviderActions = {
  discoverModels: async (providerId) => {
    const result = await invoke<{ models: AgentServerProvider['models'] }>(
      'desktop_discover_provider_models',
      { providerId },
    );
    return result.models;
  },
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

/** Project locations. Folder selection and the control grant stay native. */
export const projectActions: ProjectActions = {
  list: () => invoke('desktop_project_locations'),
  save: (input) =>
    invoke<ProjectLocation>('desktop_save_project_location', { input }),
  remove: async (name) => {
    await invoke('desktop_remove_project_location', { name });
  },
  chooseFolder: () => invoke<string | null>('desktop_choose_project_folder'),
};

export function listSubscriptions(): Promise<AgentServerSubscription[]> {
  return invoke<AgentServerSubscription[]>('desktop_subscriptions');
}

export function listProviders(): Promise<Record<string, AgentServerProvider>> {
  return invoke<Record<string, AgentServerProvider>>('desktop_providers');
}

export const runCenterActions: RunCenterActions = {
  signInOperator: () => invoke('desktop_operator_sign_in'),
  cancelOperatorApproval: () => invoke('desktop_cancel_operator_approval'),
  enrollTeam: (identity, request) =>
    invoke('desktop_enroll_team', { identity, request }),
  catalogue: (identity) =>
    invoke<AgentServerCatalogue>('desktop_catalogue', { identity }),

  startRun: (input: StartRunInput) =>
    invoke<AgentServerRun>('desktop_start_run', {
      spec: {
        agent: input.agent,
        teamId: input.teamId,
        ...(input.projectId !== undefined
          ? { projectId: input.projectId }
          : {}),
        ...(input.binding !== undefined ? { binding: input.binding } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.workspaceStrategy !== undefined
          ? { workspaceStrategy: input.workspaceStrategy }
          : {}),
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
    const key = await presetStorageKey();
    const presets = readPresets(key);
    const existing = input.id
      ? presets.find((preset) => preset.id === input.id)
      : undefined;
    const preset: RunPreset = {
      version: 2,
      id: existing?.id ?? crypto.randomUUID(),
      name: input.name,
      agent: input.agent,
      teamId: input.teamId,
      diaryId: input.diaryId,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.binding ? { binding: input.binding } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.workspaceStrategy
        ? { workspaceStrategy: input.workspaceStrategy }
        : {}),
      profileIds: input.profileIds,
      taskTypes: input.taskTypes,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastUsedAt: existing?.lastUsedAt ?? null,
    };
    writePresets(
      key,
      existing
        ? presets.map((entry) => (entry.id === preset.id ? preset : entry))
        : [...presets, preset],
    );
    return preset;
  },

  deletePreset: async (presetId) => {
    const key = await presetStorageKey();
    writePresets(
      key,
      readPresets(key).filter((preset) => preset.id !== presetId),
    );
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
