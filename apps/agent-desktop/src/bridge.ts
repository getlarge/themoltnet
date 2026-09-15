import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type LifecycleState =
  | 'checking'
  | 'needs_install'
  | 'installing'
  | 'needs_trust'
  | 'starting'
  | 'running'
  | 'update_available'
  | 'stopping'
  | 'removed'
  | 'failed';

export interface DesktopStatus {
  state: LifecycleState;
  installedVersion: string | null;
  availableVersion: string | null;
  trustFingerprint: string | null;
  trusted: boolean;
  message: string;
  logs: string[];
}

export const INITIAL_STATUS: DesktopStatus = {
  state: 'checking',
  installedVersion: null,
  availableVersion: null,
  trustFingerprint: null,
  trusted: false,
  message: 'Checking the local agent bundle…',
  logs: [],
};

export const desktopBridge = {
  status: () => invoke<DesktopStatus>('desktop_status'),
  install: () => invoke<DesktopStatus>('install_agent'),
  trust: () => invoke<DesktopStatus>('approve_local_trust'),
  retry: () => invoke<DesktopStatus>('retry_server'),
  checkForUpdates: () => invoke<DesktopStatus>('check_for_agent_updates'),
  installUpdate: () => invoke<DesktopStatus>('install_agent_update'),
  openConsole: () => invoke<void>('open_console'),
  openLogs: () => invoke<void>('open_logs'),
  removeTrust: () => invoke<DesktopStatus>('remove_local_trust'),
  remove: (removeLocalCa: boolean) =>
    invoke<DesktopStatus>('remove_agent_bundle', { removeLocalCa }),
  quit: () => invoke<void>('quit_and_stop'),
  checkDesktopUpdate: () => invoke<string | null>('check_for_desktop_update'),
  installDesktopUpdate: () => invoke<void>('install_desktop_update'),
  subscribe: (handler: (status: DesktopStatus) => void) =>
    listen<DesktopStatus>('agent-desktop://status', (event) =>
      handler(event.payload),
    ),
  subscribeRemoveRequest: (handler: () => void) =>
    listen('agent-desktop://request-remove', handler),
};
