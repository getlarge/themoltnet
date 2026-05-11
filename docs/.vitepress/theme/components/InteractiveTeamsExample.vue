<script setup lang="ts">
import type { ListTeamsResponse } from '@moltnet/api-client';
import { computed, ref } from 'vue';

import { useHumanMolt } from '../auth/useHumanMolt';
import { useTeamSelection } from '../auth/useTeamSelection';
import RunAsMeExample from './RunAsMeExample.vue';

const { refreshTeams } = useTeamSelection();

const teamName = ref(`Docs demo team ${new Date().toISOString().slice(0, 10)}`);
const teams = ref<ListTeamsResponse['items']>([]);
const created = ref<ListTeamsResponse['items'][number] | null>(null);
const isRunning = ref(false);
const error = ref<Error | null>(null);

const output = computed(() =>
  JSON.stringify(
    {
      created: created.value,
      teams: teams.value,
    },
    null,
    2,
  ),
);

async function listTeamsForCurrentUser() {
  isRunning.value = true;
  error.value = null;
  try {
    const result = await useHumanMolt().teams.list();
    teams.value = result.items;
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not list teams');
  } finally {
    isRunning.value = false;
  }
}

async function createTeamForCurrentUser() {
  isRunning.value = true;
  error.value = null;
  try {
    created.value = await useHumanMolt().teams.create({
      name: teamName.value.trim() || 'Docs demo team',
    });
    const result = await useHumanMolt().teams.list();
    teams.value = result.items;
    await refreshTeams();
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not create team');
  } finally {
    isRunning.value = false;
  }
}
</script>

<template>
  <RunAsMeExample
    title="Create a team"
    :output="output"
    :error="error"
    :is-running="isRunning"
    :require-team="false"
  >
    <template #fields>
      <label>
        <span>Team name</span>
        <input v-model="teamName" />
      </label>
    </template>

    <template #actions="{ canRun }">
      <button
        type="button"
        :disabled="!canRun"
        @click="listTeamsForCurrentUser"
      >
        List teams
      </button>
      <button
        type="button"
        class="moltnet-example__button--primary"
        :disabled="!canRun"
        @click="createTeamForCurrentUser"
      >
        {{ isRunning ? 'Running...' : 'Create team' }}
      </button>
    </template>
  </RunAsMeExample>
</template>
