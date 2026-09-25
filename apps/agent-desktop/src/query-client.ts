import { focusManager, QueryClient } from '@tanstack/react-query';

import { runCenterKeys } from './run-center/queries.js';

/**
 * Query's browser defaults are wrong in this app, in two ways that both fail
 * silently — the interval keeps firing, nothing errors, and `refetchOnMount`
 * still works, so only polling dies.
 *
 * 1. `focusManager` falls back to `document.visibilityState`, which our
 *    embedded WebView reports as `hidden` while the window is plainly visible
 *    (see apps/agent-desktop-e2e/src/native-visibility.ts). Every interval
 *    fetch is then suppressed forever. `installWindowFocusTracking` replaces
 *    that heuristic with the window's real focus state.
 * 2. `networkMode` defaults to `online`, which gates fetches on
 *    `navigator.onLine`. Our reads go to a daemon on this machine over native
 *    IPC, so losing the network says nothing about whether it is reachable.
 */
export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        networkMode: 'always',
        staleTime: 30_000,
      },
    },
  });
  // The catalogue verifies team credentials against the MoltNet API, so a
  // single slow or throttled read is common and not worth a banner. Retry it
  // gently before reporting a failure.
  client.setQueryDefaults(runCenterKeys.catalogues(), {
    retry: CATALOGUE_RETRIES,
    retryDelay: catalogueRetryDelay,
  });
  return client;
}

export const CATALOGUE_RETRIES = 2;

export function catalogueRetryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** attempt, 4_000);
}

/** Resolves the window's focus state; injected so tests need no native host. */
export interface WindowFocusSource {
  isFocused: () => Promise<boolean>;
  onFocusChanged: (handler: (focused: boolean) => void) => () => void;
}

/**
 * Points Query's focus tracking at the real window instead of
 * `document.visibilityState`.
 *
 * `setEventListener` replaces the default `visibilitychange` listener, which is
 * the source of the bug. The callback must be passed a boolean: calling it bare
 * re-enters the same broken check.
 */
export function installWindowFocusTracking(source: WindowFocusSource): void {
  focusManager.setEventListener((handleFocus) => {
    // No focus event arrives until the state next changes, so seed it. A
    // rejected seed must not take down startup: the first real focus change
    // corrects it, and assuming focused is right for a window just launched.
    source.isFocused().then(
      (focused) => handleFocus(focused),
      () => handleFocus(true),
    );
    return source.onFocusChanged(handleFocus);
  });
}
