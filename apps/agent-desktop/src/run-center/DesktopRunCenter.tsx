import './run-center.css';

import { invoke } from '@tauri-apps/api/core';
import { InlineNotice } from '@themoltnet/design-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { desktopBridge, INITIAL_STATUS } from '../bridge.js';
import { listPresets, runCenterActions } from './run-center-bridge.js';
import { RunCenterApp } from './RunCenterApp.js';
import type {
  AgentServerCatalogue,
  AgentServerStatus,
  RunCenterActions,
} from './types.js';

/** Native IPC owns all server access; this renderer receives public state only. */
export function DesktopRunCenter() {
  const [server, setServer] = useState(INITIAL_STATUS);
  const [status, setStatus] = useState<AgentServerStatus | null>(null);
  const [catalogue, setCatalogue] = useState<AgentServerCatalogue | null>(null);
  const [presets, setPresets] = useState(listPresets);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now);
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
        failures.current = 0;
        setError(false);
        const identity =
          snapshot.selectedIdentity ?? snapshot.agents[0]?.agentName;
        if (refreshCatalogue || Date.now() - lastCatalogue.current > 60_000) {
          const next = identity
            ? await runCenterActions.catalogue(identity)
            : null;
          if (currentEpoch === epoch.current) {
            setCatalogue(next);
            lastCatalogue.current = Date.now();
          }
        }
        setPresets(listPresets());
      } catch {
        if (currentEpoch !== epoch.current) return;
        failures.current++;
        setCatalogue(null);
        setError(true);
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
        if (active) setError(true);
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
          if (active) setError(true);
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
      setStatus(null);
      setCatalogue(null);
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
        await runCenterActions.savePreset(input);
        setPresets(listPresets());
      },
      deletePreset: async (id) => {
        await runCenterActions.deletePreset(id);
        setPresets(listPresets());
      },
    }),
    [refresh],
  );
  return (
    <>
      {error && ['running', 'update_available'].includes(server.state) ? (
        <InlineNotice tone="warning" title="Local state could not be refreshed">
          Check the Server view. Previously displayed metadata may be stale.
        </InlineNotice>
      ) : null}
      <RunCenterApp
        now={now}
        data={{
          server,
          status,
          catalogue,
          presets,
          providers: status?.providers ?? {},
          subscriptions: status?.subscriptions ?? [],
          runs: (status?.runs ?? []).map((run) => ({
            ...run,
            presetName:
              presets.find(
                (preset) =>
                  preset.agent === run.agent &&
                  preset.teamId === run.teamId &&
                  (preset.diaryId ?? null) === (run.diaryId ?? null) &&
                  JSON.stringify(preset.profileIds) ===
                    JSON.stringify(run.profiles) &&
                  JSON.stringify([...preset.taskTypes].sort()) ===
                    JSON.stringify([...run.taskTypes].sort()),
              )?.name ?? null,
            teamName:
              catalogue?.teams.find((team) => team.teamId === run.teamId)
                ?.teamName ?? null,
          })),
        }}
        actions={actions}
      />
    </>
  );
}
