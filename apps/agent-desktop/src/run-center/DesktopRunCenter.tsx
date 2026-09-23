import './run-center.css';

import { invoke } from '@tauri-apps/api/core';
import { InlineNotice } from '@themoltnet/design-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { desktopBridge, INITIAL_STATUS } from '../bridge.js';
import { findRunPreset } from './preset-matching.js';
import {
  listPresets,
  projectActions,
  runCenterActions,
} from './run-center-bridge.js';
import { RunCenterApp } from './RunCenterApp.js';
import type {
  AgentServerCatalogue,
  AgentServerStatus,
  RunCenterActions,
  RunPreset,
} from './types.js';
import { CATALOGUE_ERROR } from './useComposerCatalogue.js';

/** Native IPC owns all server access; this renderer receives public state only. */
export function DesktopRunCenter() {
  const [server, setServer] = useState(INITIAL_STATUS);
  const [status, setStatus] = useState<AgentServerStatus | null>(null);
  const [operatorConfigured, setOperatorConfigured] = useState(false);
  const [operatorEmail, setOperatorEmail] = useState<string | null>(null);
  const projectLocations = useRef<{
    promise: Promise<Awaited<ReturnType<typeof projectActions.list>>> | null;
  }>({ promise: null });
  const [catalogue, setCatalogue] = useState<AgentServerCatalogue | null>(null);
  const [catalogueIdentity, setCatalogueIdentity] = useState<string | null>(
    null,
  );
  const catalogueSnapshot = useRef<{
    identity: string | null;
    value: AgentServerCatalogue | null;
  }>({ identity: null, value: null });
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [presets, setPresets] = useState<RunPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
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
  const lastCatalogue = useRef(0);
  const refresh = useCallback(function refreshSnapshot(
    refreshCatalogue = true,
  ): Promise<void> {
    if (inFlight.current) {
      // Mutations need a read started after they completed, not an older poll.
      return refreshCatalogue
        ? inFlight.current.then(() => refreshSnapshot(true))
        : inFlight.current;
    }
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
        const identity =
          snapshot.selectedIdentity ?? snapshot.agents[0]?.agentName ?? null;
        const changedIdentity = catalogueSnapshot.current.identity !== identity;
        if (
          refreshCatalogue ||
          changedIdentity ||
          Date.now() - lastCatalogue.current > 60_000
        ) {
          setCatalogueIdentity(identity);
          if (changedIdentity) {
            catalogueSnapshot.current = { identity, value: null };
            setCatalogue(null);
          }
          if (refreshCatalogue || !catalogueSnapshot.current.value)
            setCatalogueLoading(true);
          try {
            const next = identity
              ? await runCenterActions.catalogue(identity)
              : null;
            if (currentEpoch === epoch.current) {
              catalogueSnapshot.current = { identity, value: next };
              setCatalogue(next);
              setCatalogueError(null);
              lastCatalogue.current = Date.now();
            }
          } catch {
            if (currentEpoch === epoch.current) {
              setCatalogueError(CATALOGUE_ERROR);
            }
          } finally {
            if (currentEpoch === epoch.current) setCatalogueLoading(false);
          }
        }
      } catch (cause) {
        if (currentEpoch !== epoch.current) return;
        failures.current++;
        setCatalogue(null);
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
    if (!['running', 'update_available'].includes(server.state)) {
      projectLocations.current.promise = null;
      setStatus(null);
      catalogueSnapshot.current = { identity: null, value: null };
      setCatalogueIdentity(null);
      setOperatorConfigured(false);
      setOperatorEmail(null);
      setCatalogue(null);
      setCatalogueLoading(false);
      setCatalogueError(null);
      return;
    }
    let stopped = false;
    let timer: number | undefined;
    let generation = 0;
    const poll = async (current: number, includeCatalogue = false) => {
      if (stopped || document.visibilityState === 'hidden') return;
      setNow(Date.now());
      await refresh(includeCatalogue);
      if (!stopped && generation === current)
        timer = window.setTimeout(
          () => void poll(current),
          Math.min(60_000, 5_000 * 2 ** failures.current),
        );
    };
    const visible = () => {
      window.clearTimeout(timer);
      void poll(++generation, true);
    };
    document.addEventListener('visibilitychange', visible);
    visible();
    return () => {
      stopped = true;
      epoch.current++;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [server.state, refresh]);
  const projects = useMemo(
    () => ({
      ...projectActions,
      invalidate: () => undefined,
      list: () => {
        if (!projectLocations.current.promise) {
          projectLocations.current.promise = projectActions.list().then(
            (value) => {
              projectLocations.current.promise = null;
              return value;
            },
            (error) => {
              projectLocations.current.promise = null;
              throw error;
            },
          );
        }
        return projectLocations.current.promise;
      },
      save: async (...args: Parameters<typeof projectActions.save>) => {
        return projectActions.save(...args);
      },
      remove: async (...args: Parameters<typeof projectActions.remove>) => {
        await projectActions.remove(...args);
      },
    }),
    [],
  );
  const actions = useMemo<RunCenterActions>(
    () => ({
      ...runCenterActions,
      refresh,
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
    [refresh],
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
          catalogue,
          catalogueIdentity,
          catalogueLoading,
          catalogueError,
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
