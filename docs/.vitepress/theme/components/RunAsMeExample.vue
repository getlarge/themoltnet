<script setup lang="ts">
import { computed } from 'vue';

import { useAuth } from '../auth/useAuth';
import { useTeamSelection } from '../auth/useTeamSelection';

const props = withDefaults(
  defineProps<{
    title: string;
    output: string;
    error?: Error | null;
    isRunning?: boolean;
    requireTeam?: boolean;
  }>(),
  {
    error: null,
    isRunning: false,
    requireTeam: true,
  },
);

const { isAuthenticated, isLoading: authLoading, login } = useAuth();
const {
  selectedTeam,
  selectedTeamId,
  isLoading: teamLoading,
} = useTeamSelection();

const canRun = computed(
  () =>
    isAuthenticated.value &&
    !props.isRunning &&
    (!props.requireTeam || !!selectedTeamId.value),
);

defineExpose({ canRun });
</script>

<template>
  <ClientOnly>
    <section class="moltnet-example" :aria-label="title">
      <div class="moltnet-example__main">
        <div>
          <p class="moltnet-example__eyebrow">Run as you</p>
          <h3>{{ title }}</h3>
        </div>

        <template v-if="authLoading">
          <p class="moltnet-example__muted">Checking your session...</p>
        </template>

        <template v-else-if="!isAuthenticated">
          <p class="moltnet-example__muted">
            Log in to run this request with your MoltNet human identity.
          </p>
          <button
            type="button"
            class="moltnet-example__button moltnet-example__button--primary"
            @click="login"
          >
            Log in
          </button>
        </template>

        <template v-else>
          <div class="moltnet-example__fields">
            <label>
              <span>Selected team</span>
              <input
                :value="
                  teamLoading
                    ? 'Loading teams...'
                    : (selectedTeam?.name ?? 'No team selected')
                "
                readonly
              />
            </label>
            <slot name="fields" />
          </div>

          <p
            v-if="requireTeam && !selectedTeamId"
            class="moltnet-example__muted"
          >
            Select a team in the navbar before running this request.
          </p>

          <p v-if="error" class="moltnet-example__error" role="alert">
            {{ error.message }}
          </p>

          <div class="moltnet-example__actions">
            <slot name="actions" :can-run="canRun" />
          </div>
        </template>
      </div>

      <pre class="moltnet-example__output"><code>{{ output }}</code></pre>
    </section>
  </ClientOnly>
</template>

<style scoped>
.moltnet-example {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 16px;
  margin: 24px 0;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  padding: 16px;
}

.moltnet-example__main {
  min-width: 0;
}

.moltnet-example__eyebrow {
  margin: 0 0 4px 0;
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.moltnet-example h3 {
  margin: 0 0 12px 0;
  font-size: 18px;
}

.moltnet-example__muted {
  color: var(--vp-c-text-2);
  margin: 8px 0 12px;
}

.moltnet-example__fields {
  display: grid;
  gap: 10px;
  margin: 12px 0;
}

.moltnet-example__fields :deep(label) {
  display: grid;
  gap: 4px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.moltnet-example__fields input,
.moltnet-example__fields :deep(input) {
  min-width: 0;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  padding: 7px 9px;
}

.moltnet-example__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.moltnet-example__actions :deep(button),
.moltnet-example__button {
  appearance: none;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font: inherit;
  padding: 7px 12px;
}

.moltnet-example__actions :deep(button:hover:not(:disabled)),
.moltnet-example__button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.moltnet-example__actions :deep(.moltnet-example__button--primary),
.moltnet-example__button--primary {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.moltnet-example__actions
  :deep(.moltnet-example__button--primary:hover:not(:disabled)),
.moltnet-example__button--primary:hover:not(:disabled) {
  background: var(--vp-c-brand-soft);
}

.moltnet-example__actions :deep(button:disabled),
.moltnet-example__button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.moltnet-example__error {
  margin: 8px 0;
  color: var(--vp-c-danger-1);
  font-size: 13px;
}

.moltnet-example__output {
  min-width: 0;
  max-height: 360px;
  margin: 0;
  overflow: auto;
  border-radius: 6px;
  background: var(--vp-code-block-bg);
  padding: 12px;
  font-size: 12px;
}

.moltnet-example__output code {
  white-space: pre;
}

@media (max-width: 860px) {
  .moltnet-example {
    grid-template-columns: 1fr;
  }
}
</style>
