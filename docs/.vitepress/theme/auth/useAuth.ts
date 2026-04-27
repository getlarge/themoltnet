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
const error = ref<Error | null>(null);

let initialized = false;

async function checkSession() {
  isLoading.value = true;
  error.value = null;
  try {
    session.value = await getKratosClient().toSession();
  } catch {
    session.value = null;
  } finally {
    isLoading.value = false;
  }
}

function ensureInitialized() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  void checkSession();
  setInterval(() => void checkSession(), 5 * 60 * 1000);
}

interface IdentityTraits {
  username?: string;
  email?: string;
  name?: { first?: string; last?: string } | string;
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
      window.location.assign(flow.logout_url);
    } catch (err) {
      error.value = err instanceof Error ? err : new Error('Logout failed');
    }
  }

  return {
    session: readonly(session),
    identity,
    isAuthenticated: computed(() => !!session.value?.active),
    isLoading: readonly(isLoading),
    error: readonly(error),
    username: computed(() => traits.value.username ?? null),
    email: computed(() => traits.value.email ?? null),
    refreshSession: checkSession,
    login,
    logout,
  };
}
