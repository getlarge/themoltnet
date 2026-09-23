import { getCurrentWindow } from '@tauri-apps/api/window';

import type { WindowFocusSource } from './query-client.js';

/**
 * The native window's focus state, which is what `document.visibilityState`
 * fails to report correctly in this WebView.
 *
 * `isFocused()` crosses IPC as `plugin:window|is_focused`, so it needs
 * `core:window:allow-is-focused` in the window capability. `onFocusChanged` is
 * an event subscription and is already covered by `core:event:default`.
 */
export function tauriWindowFocus(): WindowFocusSource {
  return {
    isFocused: () => getCurrentWindow().isFocused(),
    onFocusChanged: (handler) => {
      const pending = getCurrentWindow().onFocusChanged(({ payload }) =>
        handler(payload),
      );
      return () => {
        void pending.then((unlisten) => unlisten());
      };
    },
  };
}
