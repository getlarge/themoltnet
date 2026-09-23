/**
 * Exercises the real startup wiring, including the native focus source, so a
 * mistake in main.tsx's composition is caught rather than only in a
 * test-local stand-in.
 */
import { focusManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installWindowFocusTracking } from './query-client.js';
import { tauriWindowFocus } from './window-focus.js';

const listeners = new Set<(focused: boolean) => void>();
const isFocused = vi.fn<() => Promise<boolean>>();
let listenThrows = false;

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFocused,
    onFocusChanged: (handler: (event: { payload: boolean }) => void) => {
      if (listenThrows) throw new Error('plugin:event|listen not available');
      const wrapped = (focused: boolean) => handler({ payload: focused });
      listeners.add(wrapped);
      return Promise.resolve(() => listeners.delete(wrapped));
    },
  }),
}));

function emitFocus(focused: boolean) {
  for (const listener of [...listeners]) listener(focused);
}

describe('native focus tracking', () => {
  beforeEach(() => {
    listeners.clear();
    isFocused.mockReset().mockResolvedValue(true);
    listenThrows = false;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
  });
  afterEach(() => {
    // Hand focus back to the default heuristic for unrelated suites.
    focusManager.setEventListener(() => undefined);
    focusManager.setFocused(undefined);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('reports focus from the window while the WebView claims hidden', async () => {
    installWindowFocusTracking(tauriWindowFocus());
    // `visibilityState` stays 'hidden' here, so this passing means the focus
    // state came from the window rather than the browser heuristic.
    await vi.waitFor(() => expect(focusManager.isFocused()).toBe(true));
    expect(isFocused).toHaveBeenCalled();
  });

  it('tracks later focus changes', async () => {
    installWindowFocusTracking(tauriWindowFocus());
    await vi.waitFor(() => expect(focusManager.isFocused()).toBe(true));
    emitFocus(false);
    expect(focusManager.isFocused()).toBe(false);
    emitFocus(true);
    expect(focusManager.isFocused()).toBe(true);
  });

  it('starts and assumes focus without a Tauri host', async () => {
    // The journey suite runs this renderer under plain Chrome, where the IPC
    // bridge answers `invoke` commands but not window or event APIs. Startup
    // must survive that, or no journey can mount the app at all.
    isFocused.mockRejectedValue(new Error('window.getCurrent not available'));
    listenThrows = true;
    expect(() => installWindowFocusTracking(tauriWindowFocus())).not.toThrow();
    await vi.waitFor(() => expect(focusManager.isFocused()).toBe(true));
  });

  it('assumes focus when the capability to read it is missing', async () => {
    // `is_focused` needs core:window:allow-is-focused; a denied invoke must not
    // leave polling wedged off, and must not take down startup.
    isFocused.mockRejectedValue(new Error('window.is_focused not allowed'));
    installWindowFocusTracking(tauriWindowFocus());
    await vi.waitFor(() => expect(focusManager.isFocused()).toBe(true));
  });
});
