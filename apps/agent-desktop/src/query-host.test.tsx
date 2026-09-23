/**
 * These tests pin the two Query defaults that are wrong in an embedded WebView.
 *
 * Both failures are silent: the timer keeps firing, no error is raised, no
 * `fetchStatus` changes, and `refetchOnMount` still works — so a broken build
 * navigates correctly and only stops polling. The e2e suite cannot catch the
 * first one either, because `native-visibility.ts` patches the very getter that
 * is broken. That is why they are pinned here, at the unit level, with the
 * hostile host signal simulated rather than patched away.
 */
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createQueryClient,
  installWindowFocusTracking,
} from './query-client.js';
import { useCatalogueProbe } from './query-host.test-support.js';

/** A focused window, as the native host would report it. */
function focusedWindow(onFocusChanged = () => () => {}) {
  return {
    isFocused: () => Promise.resolve(true),
    onFocusChanged,
  };
}

/** Our embedded WebKit reports `hidden` while the window is plainly visible. */
function simulateWebViewVisibilityBug() {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
}

function restoreVisibility() {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
}

async function flush() {
  // Query settles on microtasks; `waitFor` hangs under fake timers.
  await act(async () => {
    await Promise.resolve();
  });
}

function mount(client: QueryClient, fetcher: () => Promise<string>) {
  function Probe() {
    useCatalogueProbe(fetcher);
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('polling inside an embedded WebView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    simulateWebViewVisibilityBug();
  });
  afterEach(() => {
    vi.useRealTimers();
    restoreVisibility();
  });

  it('keeps polling when the WebView misreports visibility as hidden', async () => {
    const fetcher = vi.fn().mockResolvedValue('catalogue');
    const client = createQueryClient();
    installWindowFocusTracking(focusedWindow());
    mount(client, fetcher);
    await flush();
    // refetchOnMount is not focus-gated, so the first read always lands. This
    // is what makes the failure survive manual QA.
    expect(fetcher).toHaveBeenCalledTimes(1);

    for (let tick = 0; tick < 3; tick++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
    }

    // Without the Tauri focus listener this stays at 1, forever, silently.
    expect(fetcher.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps polling the local daemon while the machine is offline', async () => {
    const fetcher = vi.fn().mockResolvedValue('catalogue');
    const client = createQueryClient();
    restoreVisibility();
    installWindowFocusTracking(focusedWindow());
    mount(client, fetcher);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // The daemon is on this machine; losing Wi-Fi does not make it unreachable.
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetcher.mock.calls.length).toBeGreaterThan(1);
  });
});
