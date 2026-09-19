import './run-center.css';

import { invoke } from '@tauri-apps/api/core';
import { InlineNotice } from '@themoltnet/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
  const refresh = useCallback(async (refreshCatalogue = true) => {
    try {
      const snapshot = await invoke<AgentServerStatus>(
        'desktop_control_status',
      );
      setStatus(snapshot);
      setError(false);
      const identity =
        snapshot.selectedIdentity ?? snapshot.agents[0]?.agentName;
      if (refreshCatalogue) {
        if (identity) setCatalogue(await runCenterActions.catalogue(identity));
        else setCatalogue(null);
      }
      setPresets(listPresets());
    } catch {
      setCatalogue(null);
      setError(true);
    }
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
    if (!['running', 'update_available'].includes(server.state)) {
      setStatus(null);
      setCatalogue(null);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
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
          runs: (status?.runs ?? []).map((run) => ({
            ...run,
            presetName: null,
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
