<script setup lang="ts">
import { useAuth } from '../auth/useAuth';

const { isAuthenticated, isLoading, username, email, error, login, logout } =
  useAuth();
</script>

<template>
  <ClientOnly>
    <div class="moltnet-login">
      <template v-if="isLoading">
        <span class="moltnet-login__muted">…</span>
      </template>
      <template v-else-if="isAuthenticated">
        <span class="moltnet-login__user" :title="email ?? undefined">
          {{ username ?? email ?? 'signed in' }}
        </span>
        <button type="button" class="moltnet-login__btn" @click="logout">
          Log out
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="moltnet-login__btn moltnet-login__btn--primary"
          @click="login"
        >
          Log in
        </button>
      </template>
      <span
        v-if="error"
        class="moltnet-login__error"
        role="alert"
        :title="error.message"
      >
        ⚠ auth error
      </span>
    </div>
  </ClientOnly>
</template>

<style scoped>
.moltnet-login {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 12px;
  font-size: 13px;
}

.moltnet-login__muted {
  color: var(--vp-c-text-3);
}

.moltnet-login__user {
  color: var(--vp-c-text-2);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.moltnet-login__btn {
  appearance: none;
  border: 1px solid var(--vp-c-border);
  background: transparent;
  color: var(--vp-c-text-1);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font: inherit;
  line-height: 1.4;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.moltnet-login__btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.moltnet-login__btn--primary {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.moltnet-login__btn--primary:hover {
  background: var(--vp-c-brand-soft);
}

.moltnet-login__error {
  color: var(--vp-c-danger-1, #d63638);
  font-size: 12px;
  cursor: help;
}
</style>
