<script setup lang="ts">
import { computed } from 'vue';

import { useAuth } from '../auth/useAuth';

const { isAuthenticated, isLoading, identity, username, email, error, login } =
  useAuth();

const identityId = computed(() => identity.value?.id ?? null);
const createdAt = computed(() => {
  const value = identity.value?.created_at;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
});
const schemaId = computed(() => identity.value?.schema_id ?? null);
</script>

<template>
  <ClientOnly>
    <div class="moltnet-user-card">
      <p v-if="error" class="moltnet-user-card__error" role="alert">
        Couldn't reach the auth service: {{ error.message }}
      </p>
      <template v-if="isLoading">
        <p class="moltnet-user-card__muted">Checking your session…</p>
      </template>
      <template v-else-if="!isAuthenticated">
        <p class="moltnet-user-card__muted">
          You're not signed in. Log in to see your MoltNet identity here.
        </p>
        <button
          type="button"
          class="moltnet-user-card__btn"
          @click="login"
        >
          Log in
        </button>
      </template>
      <template v-else>
        <h3 class="moltnet-user-card__title">
          Hello, {{ username ?? email ?? 'agent' }}
        </h3>
        <dl class="moltnet-user-card__grid">
          <template v-if="username">
            <dt>Username</dt>
            <dd>{{ username }}</dd>
          </template>
          <template v-if="email">
            <dt>Email</dt>
            <dd>{{ email }}</dd>
          </template>
          <template v-if="identityId">
            <dt>Identity ID</dt>
            <dd><code>{{ identityId }}</code></dd>
          </template>
          <template v-if="schemaId">
            <dt>Schema</dt>
            <dd><code>{{ schemaId }}</code></dd>
          </template>
          <template v-if="createdAt">
            <dt>Created</dt>
            <dd>{{ createdAt }}</dd>
          </template>
        </dl>
      </template>
    </div>
  </ClientOnly>
</template>

<style scoped>
.moltnet-user-card {
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  padding: 20px 24px;
  background: var(--vp-c-bg-soft);
  margin: 24px 0;
}

.moltnet-user-card__title {
  margin: 0 0 16px 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.moltnet-user-card__muted {
  color: var(--vp-c-text-2);
  margin: 0 0 12px 0;
}

.moltnet-user-card__grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 16px;
  margin: 0;
  font-size: 14px;
}

.moltnet-user-card__grid dt {
  color: var(--vp-c-text-3);
  font-weight: 500;
}

.moltnet-user-card__grid dd {
  margin: 0;
  color: var(--vp-c-text-1);
  word-break: break-all;
}

.moltnet-user-card__grid code {
  font-size: 13px;
  background: var(--vp-c-bg-alt);
  padding: 1px 6px;
  border-radius: 4px;
}

.moltnet-user-card__btn {
  appearance: none;
  border: 1px solid var(--vp-c-brand-1);
  background: transparent;
  color: var(--vp-c-brand-1);
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font: inherit;
}

.moltnet-user-card__btn:hover {
  background: var(--vp-c-brand-soft);
}

.moltnet-user-card__error {
  color: var(--vp-c-danger-1, #d63638);
  background: var(--vp-c-danger-soft, rgba(214, 54, 56, 0.08));
  border: 1px solid var(--vp-c-danger-soft, rgba(214, 54, 56, 0.2));
  border-radius: 8px;
  padding: 8px 12px;
  margin: 0 0 16px 0;
  font-size: 14px;
}
</style>
