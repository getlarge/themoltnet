/**
 * Vue 3 composable that mirrors the console's React AuthProvider.
 *
 * State is module-level so every component sees the same session — the docs
 * site is purely informational (no gating), so we just expose login/logout
 * affordances and identity traits to render.
 */

import type { Identity, Session } from '@ory/client-fetch';
import { computed, readonly, ref } from 'vue';

import { getAuthConfig } from './config';
import { getKratosClient } from './kratos';

const session = ref<Session | null>(null);
const isLoading = ref(true);
const isRefreshing = ref(false);
const error = ref<Error | null>(null);

let initialized = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function isClientError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('status' in err))
    return false;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

async function checkSession({ background = false } = {}) {
  if (background) {
    isRefreshing.value = true;
  } else {
    isLoading.value = true;
  }
  try {
    session.value = await getKratosClient().toSession();
    error.value = null;
  } catch (err) {
    session.value = null;
    // 4xx (no/expired session) is the expected hot path — stay quiet.
    // 5xx, network timeouts, and unknown errors mean Kratos is degraded
    // and must be observable. Mirrors libs/auth/src/session-resolver.ts.
    if (isClientError(err)) {
      error.value = null;
    } else {
      error.value =
        err instanceof Error ? err : new Error('Session check failed');
      console.warn('[useAuth] Kratos toSession error:', err);
    }
  } finally {
    isLoading.value = false;
    isRefreshing.value = false;
  }
}

function teardown() {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  initialized = false;
}

function ensureInitialized() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  void checkSession();
  refreshTimer = setInterval(
    () => void checkSession({ background: true }),
    5 * 60 * 1000,
  );
  // Vite HMR re-runs this module on save; clear the previous timer so
  // dev sessions don't stack pollers against auth.themolt.net.
  if (import.meta.hot) {
    import.meta.hot.dispose(teardown);
  }
}

interface IdentityTraits {
  username?: string;
  email?: string;
}

export function useAuth() {
  ensureInitialized();

  const identity = computed<Identity | null>(
    () => session.value?.identity ?? null,
  );
  const traits = computed<IdentityTraits>(
    () => (identity.value?.traits as IdentityTraits | undefined) ?? {},
  );

  function login() {
    if (typeof window === 'undefined') return;
    const returnTo = encodeURIComponent(window.location.href);
    window.location.assign(
      `${getAuthConfig().kratosUrl}/self-service/login/browser?return_to=${returnTo}`,
    );
  }

  async function logout() {
    if (typeof window === 'undefined') return;
    try {
      const flow = await getKratosClient().createBrowserLogoutFlow();
      const expectedOrigin = new URL(getAuthConfig().kratosUrl).origin;
      const target = new URL(flow.logout_url);
      if (target.origin !== expectedOrigin) {
        throw new Error(
          `Refusing logout redirect to unexpected origin: ${target.origin}`,
        );
      }
      window.location.assign(target.toString());
    } catch (err) {
      error.value = err instanceof Error ? err : new Error('Logout failed');
      console.warn('[useAuth] logout failed:', err);
    }
  }

  return {
    session: readonly(session),
    identity,
    isAuthenticated: computed(() => !!session.value?.active),
    isLoading: readonly(isLoading),
    isRefreshing: readonly(isRefreshing),
    error: readonly(error),
    username: computed(() => traits.value.username ?? null),
    email: computed(() => traits.value.email ?? null),
    refreshSession: () => checkSession({ background: true }),
    login,
    logout,
  };
}
