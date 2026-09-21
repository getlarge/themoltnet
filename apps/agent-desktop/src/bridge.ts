import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type LifecycleState =
  | 'checking'
  | 'needs_install'
  | 'installing'
  | 'starting'
  | 'running'
  | 'update_available'
  | 'stopping'
  | 'stopped'
  | 'removed'
  | 'failed';

export interface DesktopStatus {
  state: LifecycleState;
  installedVersion: string | null;
  availableVersion: string | null;
  message: string;
  logs: string[];
}

export interface DesktopUpdateCheck {
  availableVersion: string | null;
  message: string;
}

export const INITIAL_STATUS: DesktopStatus = {
  state: 'checking',
  installedVersion: null,
  availableVersion: null,
  message: 'Checking the local agent bundle…',
  logs: [],
};

export interface ConnectionSettings {
  apiUrl: string;
  issuer: string;
  publicUrl: string;
  nativeClientId: string;
  consoleClientId: string;
}
export interface ConnectionSettingsView {
  defaults: ConnectionSettings;
  effective: ConnectionSettings;
  overrides: Partial<ConnectionSettings>;
  environment: Partial<ConnectionSettings>;
}

export const desktopBridge = {
  connectionSettings: () =>
    invoke<ConnectionSettingsView>('desktop_connection_settings'),
  applyConnectionSettings: (overrides: Partial<ConnectionSettings>) =>
    invoke<DesktopStatus>('desktop_apply_connection_settings', { overrides }),
  status: () => invoke<DesktopStatus>('desktop_status'),
  install: () => invoke<DesktopStatus>('install_agent'),
  retry: () => invoke<DesktopStatus>('retry_server'),
  start: () => invoke<DesktopStatus>('start_agent_server'),
  stop: () => invoke<DesktopStatus>('stop_agent_server'),
  checkForUpdates: () => invoke<DesktopStatus>('check_for_agent_updates'),
  installUpdate: () => invoke<DesktopStatus>('install_agent_update'),
  openLogs: () => invoke<void>('open_logs'),
  remove: () => invoke<DesktopStatus>('remove_agent_bundle'),
  checkDesktopUpdate: () =>
    invoke<DesktopUpdateCheck>('check_for_desktop_update'),
  installDesktopUpdate: () => invoke<void>('install_desktop_update'),
  subscribe: (handler: (status: DesktopStatus) => void) =>
    listen<DesktopStatus>('agent-desktop://status', (event) =>
      handler(event.payload),
    ),
  subscribeNavigation: (handler: (screen: string) => void) =>
    listen<string>('agent-desktop://navigate', (event) =>
      handler(event.payload),
    ),
  subscribeRemoveRequest: (handler: () => void) =>
    listen('agent-desktop://request-remove', handler),
};
