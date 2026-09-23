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

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFocused,
    onFocusChanged: (handler: (event: { payload: boolean }) => void) => {
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
    await vi.waitFor(() => expect(isFocused).toHaveBeenCalled());
    expect(focusManager.isFocused()).toBe(true);
  });

  it('tracks later focus changes', async () => {
    installWindowFocusTracking(tauriWindowFocus());
    await vi.waitFor(() => expect(focusManager.isFocused()).toBe(true));
    emitFocus(false);
    expect(focusManager.isFocused()).toBe(false);
    emitFocus(true);
    expect(focusManager.isFocused()).toBe(true);
  });

  it('assumes focus when the capability to read it is missing', async () => {
    // `is_focused` needs core:window:allow-is-focused; a denied invoke must not
    // leave polling wedged off, and must not take down startup.
    isFocused.mockRejectedValue(new Error('window.is_focused not allowed'));
    installWindowFocusTracking(tauriWindowFocus());
    await vi.waitFor(() => expect(focusManager.isFocused()).toBe(true));
  });
});
