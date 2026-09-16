/**
 * PROTOTYPE ONLY. Stands in for `@tauri-apps/api/core` so the *real*
 * `src/bridge.ts` and `src/ServerPanel.tsx` run in a plain browser. Nothing in
 * `src/` is copied or forked for the prototype; only the Tauri IPC boundary is
 * replaced.
 */
import type { DesktopStatus } from '../src/bridge.js';
import { scenarioData, type ScenarioId } from '../src/run-center/fixtures.js';

const params = new URLSearchParams(window.location.search);
const scenario = (params.get('scenario') ?? 'populated') as ScenarioId;

let status: DesktopStatus = scenarioData(scenario).server;
const listeners = new Set<(next: DesktopStatus) => void>();

function publish(next: Partial<DesktopStatus>): DesktopStatus {
  status = { ...status, ...next };
  for (const listener of listeners) listener(status);
  return status;
}

const HANDLERS: Record<string, () => unknown> = {
  desktop_status: () => status,
  install_agent: () =>
    publish({ state: 'needs_trust', installedVersion: '0.41.2' }),
  approve_local_trust: () =>
    publish({
      state: 'running',
      trusted: true,
      message: 'Local HTTPS is trusted for this macOS user.',
    }),
  retry_server: () => publish({ state: 'running' }),
  start_agent_server: () =>
    publish({ state: 'running', message: 'Agent Server is serving requests.' }),
  stop_agent_server: () =>
    publish({
      state: 'stopped',
      message: 'The Agent Server is stopped. Its runs stopped with it.',
    }),
  check_for_agent_updates: () => publish({ availableVersion: null }),
  install_agent_update: () => publish({ state: 'running' }),
  remove_local_trust: () => publish({ trusted: false, state: 'needs_trust' }),
  remove_agent_bundle: () =>
    publish({ state: 'removed', installedVersion: null }),
  check_for_desktop_update: () => ({
    availableVersion: null,
    message: 'MoltNet Agent is up to date.',
  }),
  install_desktop_update: () => undefined,
  open_console: () => undefined,
  open_logs: () => undefined,
  quit_and_stop: () => undefined,
};

export function invoke<T>(command: string): Promise<T> {
  const handler = HANDLERS[command];
  if (!handler) return Promise.reject(new Error(`unmocked command ${command}`));
  return new Promise((resolve) => {
    setTimeout(() => resolve(handler() as T), 260);
  });
}

export function subscribeStatus(
  handler: (next: DesktopStatus) => void,
): () => void {
  listeners.add(handler);
  return () => listeners.delete(handler);
}
