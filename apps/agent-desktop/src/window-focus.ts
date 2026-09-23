import { getCurrentWindow } from '@tauri-apps/api/window';

import type { WindowFocusSource } from './query-client.js';

/**
 * The native window's focus state, which is what `document.visibilityState`
 * fails to report correctly in this WebView.
 *
 * `isFocused()` crosses IPC as `plugin:window|is_focused`, so it needs
 * `core:window:allow-is-focused` in the window capability. `onFocusChanged`
 * subscribes through the event plugin, covered by `core:event:default`.
 *
 * Both calls need a Tauri host. The renderer also runs under plain Chrome in
 * the journey suite, where the IPC bridge only answers `invoke` commands, so
 * every call here is guarded: without a host the app reports itself focused
 * and keeps polling, rather than failing to start.
 */
export function tauriWindowFocus(): WindowFocusSource {
  return {
    isFocused: async () => {
      try {
        return await getCurrentWindow().isFocused();
      } catch {
        // No window to ask; a renderer that is running is one being looked at.
        return true;
      }
    },
    onFocusChanged: (handler) => {
      let unlisten: (() => void) | undefined;
      let cancelled = false;
      try {
        void getCurrentWindow()
          .onFocusChanged(({ payload }) => handler(payload))
          .then(
            (stop) => {
              if (cancelled) stop();
              else unlisten = stop;
            },
            () => {
              // Focus stays at whatever the seed reported.
            },
          );
      } catch {
        // Same: no subscription, no updates, polling continues.
      }
      return () => {
        cancelled = true;
        unlisten?.();
      };
    },
  };
}
