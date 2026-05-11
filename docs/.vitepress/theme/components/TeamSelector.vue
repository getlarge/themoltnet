<script setup lang="ts">
import { computed } from 'vue';

import { useAuth } from '../auth/useAuth';
import { useTeamSelection } from '../auth/useTeamSelection';

const { isAuthenticated, isLoading: authLoading, login } = useAuth();
const {
  teams,
  selectedTeamId,
  selectedTeam,
  isLoading: teamsLoading,
  error,
  refreshTeams,
  setSelectedTeam,
} = useTeamSelection();

const disabled = computed(
  () => authLoading.value || teamsLoading.value || teams.value.length === 0,
);

function onChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  setSelectedTeam(value);
}
</script>

<template>
  <ClientOnly>
    <div v-if="isAuthenticated" class="moltnet-team-selector">
      <label class="moltnet-team-selector__label" for="moltnet-team-select">
        Team
      </label>
      <select
        id="moltnet-team-select"
        class="moltnet-team-selector__select"
        :disabled="disabled"
        :value="selectedTeamId ?? ''"
        :title="selectedTeam?.name ?? 'Select MoltNet team'"
        @change="onChange"
      >
        <option v-if="teamsLoading" value="">Loading…</option>
        <option v-else-if="teams.length === 0" value="">No teams</option>
        <option v-for="team in teams" :key="team.id" :value="team.id">
          {{ team.personal ? `${team.name} · personal` : team.name }}
        </option>
      </select>
      <button
        v-if="error"
        type="button"
        class="moltnet-team-selector__retry"
        title="Retry loading teams"
        @click="refreshTeams"
      >
        Retry
      </button>
    </div>
    <button
      v-else-if="!authLoading"
      type="button"
      class="moltnet-team-selector__login"
      @click="login"
    >
      Select team
    </button>
  </ClientOnly>
</template>

<style scoped>
.moltnet-team-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  font-size: 13px;
}

.moltnet-team-selector__label {
  color: var(--vp-c-text-3);
}

.moltnet-team-selector__select {
  max-width: 190px;
  min-width: 128px;
  height: 30px;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  padding: 3px 26px 3px 8px;
}

.moltnet-team-selector__select:disabled {
  color: var(--vp-c-text-3);
  cursor: not-allowed;
}

.moltnet-team-selector__retry,
.moltnet-team-selector__login {
  appearance: none;
  height: 30px;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  font: inherit;
  padding: 3px 10px;
}

.moltnet-team-selector__retry:hover,
.moltnet-team-selector__login:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

@media (max-width: 760px) {
  .moltnet-team-selector {
    display: none;
  }
}
</style>
