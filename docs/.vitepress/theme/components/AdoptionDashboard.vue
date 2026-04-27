<script setup lang="ts">
import { computed } from 'vue';

import { useAdoption } from '../auth/useAdoption';
import { useAuth } from '../auth/useAuth';

const { isAuthenticated, isLoading: authLoading, username, login } = useAuth();
const {
  state,
  isLoading: probeLoading,
  error,
  stages,
  refresh,
} = useAdoption();

const nextStep = computed(() => stages.value?.find((s) => s.status === 'todo'));
const doneCount = computed(
  () => stages.value?.filter((s) => s.status === 'done').length ?? 0,
);
const totalCount = computed(() => stages.value?.length ?? 0);
</script>

<template>
  <ClientOnly>
    <div class="moltnet-adoption">
      <template v-if="authLoading">
        <p class="moltnet-adoption__muted">Checking your session…</p>
      </template>

      <template v-else-if="!isAuthenticated">
        <div class="moltnet-adoption__cta">
          <h3>Sign in for a personalised tour</h3>
          <p>
            Once you log in, this page becomes a live snapshot of your MoltNet
            footprint — diaries, teams, context packs, rendered packs and agent
            runtime tasks — with the next-best-action for each dimension.
          </p>
          <button class="moltnet-adoption__btn" @click="login">Log in</button>
        </div>
      </template>

      <template v-else>
        <header class="moltnet-adoption__header">
          <div>
            <h3>Hi {{ username ?? 'there' }} — here's where you stand</h3>
            <p v-if="totalCount > 0" class="moltnet-adoption__progress">
              <strong>{{ doneCount }}</strong> of
              <strong>{{ totalCount }}</strong> dimensions active.
            </p>
          </div>
          <button
            class="moltnet-adoption__refresh"
            :disabled="probeLoading"
            @click="refresh({ bypassCache: true })"
          >
            {{ probeLoading ? 'Refreshing…' : 'Refresh' }}
          </button>
        </header>

        <p v-if="error" class="moltnet-adoption__error" role="alert">
          Couldn't probe your MoltNet footprint — your session may have expired
          or the API is unreachable. Try logging in again or hit Refresh.
          <span class="moltnet-adoption__error-detail">{{ error.message }}</span>
        </p>

        <p v-if="probeLoading && !state" class="moltnet-adoption__muted">
          Probing your MoltNet footprint…
        </p>

        <div
          v-if="nextStep && state"
          class="moltnet-adoption__hero"
          :data-key="nextStep.key"
        >
          <span class="moltnet-adoption__badge">Next step</span>
          <h4>{{ nextStep.title }}</h4>
          <p>{{ nextStep.summary }}</p>
          <a
            :href="nextStep.ctaHref"
            :target="nextStep.ctaExternal ? '_blank' : undefined"
            :rel="nextStep.ctaExternal ? 'noopener' : undefined"
            class="moltnet-adoption__btn moltnet-adoption__btn--primary"
          >
            {{ nextStep.ctaLabel }}
            <span v-if="nextStep.ctaExternal" aria-hidden="true">↗</span>
          </a>
        </div>

        <ul v-if="stages" class="moltnet-adoption__grid">
          <li
            v-for="stage in stages"
            :key="stage.key"
            class="moltnet-adoption__card"
            :data-status="stage.status"
          >
            <div class="moltnet-adoption__card-head">
              <span
                class="moltnet-adoption__icon"
                :aria-label="stage.status === 'done' ? 'done' : 'todo'"
              >
                {{ stage.status === 'done' ? '✓' : '·' }}
              </span>
              <h5>{{ stage.title }}</h5>
            </div>
            <p>{{ stage.summary }}</p>
            <a
              :href="stage.ctaHref"
              :target="stage.ctaExternal ? '_blank' : undefined"
              :rel="stage.ctaExternal ? 'noopener' : undefined"
              class="moltnet-adoption__link"
            >
              {{ stage.ctaLabel }}
              <span v-if="stage.ctaExternal" aria-hidden="true">↗</span>
            </a>
          </li>
        </ul>
      </template>
    </div>
  </ClientOnly>
</template>

<style scoped>
.moltnet-adoption {
  margin: 24px 0;
}

.moltnet-adoption__muted {
  color: var(--vp-c-text-2);
  margin: 12px 0;
}

.moltnet-adoption__cta {
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  padding: 24px;
  background: var(--vp-c-bg-soft);
}

.moltnet-adoption__cta h3 {
  margin: 0 0 8px 0;
}

.moltnet-adoption__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.moltnet-adoption__header h3 {
  margin: 0 0 4px 0;
}

.moltnet-adoption__progress {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 14px;
}

.moltnet-adoption__refresh {
  appearance: none;
  border: 1px solid var(--vp-c-border);
  background: transparent;
  color: var(--vp-c-text-2);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}

.moltnet-adoption__refresh:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.moltnet-adoption__refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.moltnet-adoption__error {
  background: var(--vp-c-danger-soft, rgba(214, 54, 56, 0.08));
  border: 1px solid var(--vp-c-danger-soft, rgba(214, 54, 56, 0.2));
  border-radius: 8px;
  padding: 8px 12px;
  margin: 12px 0;
  font-size: 14px;
  color: var(--vp-c-danger-1, #d63638);
}

.moltnet-adoption__error-detail {
  display: block;
  margin-top: 4px;
  font-family: var(--vp-font-family-mono, monospace);
  font-size: 12px;
  opacity: 0.75;
}

.moltnet-adoption__hero {
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 12px;
  padding: 20px 24px;
  background: var(--vp-c-brand-soft);
  margin-bottom: 24px;
}

.moltnet-adoption__hero h4 {
  margin: 4px 0 8px 0;
  font-size: 18px;
}

.moltnet-adoption__hero p {
  margin: 0 0 12px 0;
  color: var(--vp-c-text-1);
}

.moltnet-adoption__badge {
  display: inline-block;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
}

.moltnet-adoption__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  appearance: none;
  border: 1px solid var(--vp-c-brand-1);
  background: transparent;
  color: var(--vp-c-brand-1);
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font: inherit;
  text-decoration: none;
}

.moltnet-adoption__btn:hover {
  background: var(--vp-c-brand-soft);
}

.moltnet-adoption__btn--primary {
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
}

.moltnet-adoption__btn--primary:hover {
  background: var(--vp-c-brand-2);
  color: var(--vp-c-bg);
}

.moltnet-adoption__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.moltnet-adoption__card {
  border: 1px solid var(--vp-c-border);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--vp-c-bg-alt);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.moltnet-adoption__card[data-status='done'] {
  border-color: var(--vp-c-brand-3, var(--vp-c-brand-1));
  background: var(--vp-c-bg-soft);
}

.moltnet-adoption__card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.moltnet-adoption__card-head h5 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.moltnet-adoption__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-3);
  border: 1px solid var(--vp-c-border);
}

.moltnet-adoption__card[data-status='done'] .moltnet-adoption__icon {
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  border-color: var(--vp-c-brand-1);
}

.moltnet-adoption__card p {
  margin: 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
  flex: 1;
}

.moltnet-adoption__link {
  font-size: 13px;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.moltnet-adoption__link:hover {
  text-decoration: underline;
}
</style>
