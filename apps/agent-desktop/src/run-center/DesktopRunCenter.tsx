import './run-center.css';

import { focusManager, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { InlineNotice } from '@themoltnet/design-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { desktopBridge, INITIAL_STATUS } from '../bridge.js';
import { findRunPreset } from './preset-matching.js';
import { projectLocationsQuery, runCenterKeys } from './queries.js';
import {
  listPresets,
  projectActions,
  runCenterActions,
} from './run-center-bridge.js';
import { RunCenterApp } from './RunCenterApp.js';
import type {
  AgentServerStatus,
  RunCenterActions,
  RunPreset,
} from './types.js';
import { useCatalogue } from './useCatalogue.js';

/** Native IPC owns all server access; this renderer receives public state only. */
export function DesktopRunCenter() {
  const [server, setServer] = useState(INITIAL_STATUS);
  const [status, setStatus] = useState<AgentServerStatus | null>(null);
  const [operatorConfigured, setOperatorConfigured] = useState(false);
  const [operatorEmail, setOperatorEmail] = useState<string | null>(null);
  const [presets, setPresets] = useState<RunPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const client = useQueryClient();
  const serverReady = ['running', 'update_available'].includes(server.state);
  // The identity this surface owns. Every view reads the same cache entry for
  // it; this one also refreshes it.
  const catalogueIdentity = serverReady
    ? (status?.selectedIdentity ?? status?.agents[0]?.agentName ?? null)
    : null;
  const { catalogue, retry: retryCatalogue } = useCatalogue(
    catalogueIdentity ?? '',
    {
      active: serverReady,
      poll: true,
      read: runCenterActions.catalogue,
    },
  );
  useEffect(() => {
    let current = true;
    void listPresets().then(
      (value) => {
        if (current) {
          setPresets(value);
          setPresetError(null);
        }
      },
      (cause: unknown) => {
        if (current) {
          setPresets([]);
          setPresetError(`Could not load presets: ${String(cause)}`);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [server.state]);
  const inFlight = useRef<Promise<void> | null>(null);
  const epoch = useRef(0);
  const failures = useRef(0);
  const refresh = useCallback(function refreshSnapshot(): Promise<void> {
    // Mutations need a read started after they completed, not an older poll.
    if (inFlight.current) return inFlight.current.then(() => refreshSnapshot());
    const currentEpoch = epoch.current;
    const pending = (async () => {
      try {
        const snapshot = await invoke<AgentServerStatus>(
          'desktop_control_status',
        );
        if (currentEpoch !== epoch.current) return;
        setStatus(snapshot);
        const operator = await invoke<{
          operatorConfigured?: boolean;
          email?: string | null;
        }>('desktop_operator_configured').catch(() => null);
        if (currentEpoch !== epoch.current) return;
        if (operator !== null) {
          setOperatorConfigured(operator.operatorConfigured === true);
          setOperatorEmail(operator.email ?? null);
        }
        failures.current = 0;
        setError(null);
      } catch (cause) {
        if (currentEpoch !== epoch.current) return;
        failures.current++;
        setError(
          cause instanceof Error
            ? cause.message
            : typeof cause === 'string'
              ? cause
              : 'Check the Server view. Previously displayed metadata may be stale.',
        );
      }
    })();
    inFlight.current = pending;
    void pending.finally(() => {
      if (inFlight.current === pending) inFlight.current = null;
    });
    return pending;
  }, []);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void desktopBridge.status().then(
      (value) => {
        if (active) setServer(value);
      },
      () => {
        if (active) setError('Could not read the local server state.');
      },
    );
    void desktopBridge
      .subscribe((value) => {
        if (active) setServer(value);
      })
      .then(
        (stop) => {
          if (active) unsubscribe = stop;
          else stop();
        },
        () => {
          if (active) setError('Could not subscribe to local server updates.');
        },
      );
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => {
    epoch.current++;
    if (!serverReady) {
      setStatus(null);
      setOperatorConfigured(false);
      setOperatorEmail(null);
      return;
    }
    let stopped = false;
    let timer: number | undefined;
    let generation = 0;
    const poll = async (current: number) => {
      // `focusManager`, not `document.visibilityState`: this WebView reports
      // hidden while its window is on screen, which stopped the poll outright.
      if (stopped || !focusManager.isFocused()) return;
      setNow(Date.now());
      await refresh();
      if (!stopped && generation === current)
        timer = window.setTimeout(
          () => void poll(current),
          Math.min(60_000, 5_000 * 2 ** failures.current),
        );
    };
    const resume = () => {
      window.clearTimeout(timer);
      void poll(++generation);
    };
    const unsubscribe = focusManager.subscribe((focused) => {
      if (focused) resume();
    });
    resume();
    return () => {
      stopped = true;
      epoch.current++;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [serverReady, refresh]);
  // The cache dedupes concurrent reads and `invalidate` forces a fresh one, so
  // this no longer needs a hand-held promise to coalesce on.
  const projects = useMemo(
    () => ({
      ...projectActions,
      invalidate: () => {
        void client.invalidateQueries({
          queryKey: runCenterKeys.projectLocations(),
        });
      },
      list: () =>
        client.fetchQuery(projectLocationsQuery()).then((locations) => ({
          locations,
        })),
    }),
    [client],
  );
  const actions = useMemo<RunCenterActions>(
    () => ({
      ...runCenterActions,
      // Callers expect a refresh to cover both surfaces: the status read, and
      // the catalogue entry the cache owns.
      refresh: async () => {
        await refresh();
        retryCatalogue();
      },
      startRun: async (input) => {
        const run = await runCenterActions.startRun(input);
        await refresh();
        return run;
      },
      stopRun: async (id) => {
        await runCenterActions.stopRun(id);
        await refresh();
      },
      savePreset: async (input) => {
        const saved = await runCenterActions.savePreset(input);
        // A successful write cannot become a failed save through a second read.
        setPresets((current) => [
          ...current.filter((preset) => preset.id !== saved.id),
          saved,
        ]);
        return saved;
      },
      deletePreset: async (id) => {
        await runCenterActions.deletePreset(id);
        setPresets((current) => current.filter((preset) => preset.id !== id));
      },
    }),
    [refresh, retryCatalogue],
  );
  const renderedActions = useMemo(
    () => ({ ...actions, projects }),
    [actions, projects],
  );
  return (
    <>
      {presetError && <InlineNotice tone="error">{presetError}</InlineNotice>}
      <RunCenterApp
        notice={
          error && ['running', 'update_available'].includes(server.state) ? (
            <InlineNotice
              tone="warning"
              title="Local state could not be refreshed"
            >
              {error}
            </InlineNotice>
          ) : null
        }
        now={now}
        data={{
          operatorConfigured,
          operatorEmail,
          server,
          status,
          presets,
          providers: status?.providers ?? {},
          subscriptions: status?.subscriptions ?? [],
          runs: (status?.runs ?? []).map((run) => ({
            ...run,
            presetName: findRunPreset(presets, run)?.name ?? null,
            teamName:
              catalogue?.teams.find((team) => team.teamId === run.teamId)
                ?.teamName ?? null,
          })),
        }}
        actions={renderedActions}
      />
    </>
  );
}
