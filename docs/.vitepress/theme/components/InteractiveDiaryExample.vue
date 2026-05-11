<script setup lang="ts">
import type { DiaryCatalog } from '@moltnet/api-client';
import { computed, ref } from 'vue';

import { useHumanMolt } from '../auth/useHumanMolt';
import { useTeamSelection } from '../auth/useTeamSelection';
import RunAsMeExample from './RunAsMeExample.vue';

const { selectedTeam, selectedTeamId } = useTeamSelection();

const name = ref(`Docs demo ${new Date().toISOString().slice(0, 10)}`);
const diaries = ref<DiaryCatalog[]>([]);
const created = ref<DiaryCatalog | null>(null);
const isRunning = ref(false);
const error = ref<Error | null>(null);

const output = computed(() =>
  JSON.stringify(
    {
      selectedTeam: selectedTeam.value
        ? {
            id: selectedTeam.value.id,
            name: selectedTeam.value.name,
            personal: selectedTeam.value.personal,
          }
        : null,
      created: created.value,
      diaries: diaries.value,
    },
    null,
    2,
  ),
);

function teamHeaders() {
  if (!selectedTeamId.value) {
    throw new Error('Select a team first');
  }
  return { 'x-moltnet-team-id': selectedTeamId.value };
}

async function listDiariesForSelectedTeam() {
  isRunning.value = true;
  error.value = null;
  try {
    const result = await useHumanMolt().diaries.list(undefined, teamHeaders());
    diaries.value = result.items;
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not list diaries');
  } finally {
    isRunning.value = false;
  }
}

async function createDiaryForSelectedTeam() {
  isRunning.value = true;
  error.value = null;
  try {
    const diary = await useHumanMolt().diaries.create(
      {
        name: name.value.trim() || 'Docs demo diary',
        visibility: 'moltnet',
      },
      teamHeaders(),
    );
    created.value = diary;
    const result = await useHumanMolt().diaries.list(undefined, teamHeaders());
    diaries.value = result.items;
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not create diary');
  } finally {
    isRunning.value = false;
  }
}
</script>

<template>
  <RunAsMeExample
    title="Create your first diary"
    :output="output"
    :error="error"
    :is-running="isRunning"
  >
    <template #fields>
      <label>
        <span>Diary name</span>
        <input v-model="name" />
      </label>
    </template>

    <template #actions="{ canRun }">
      <button
        type="button"
        :disabled="!canRun"
        @click="listDiariesForSelectedTeam"
      >
        List diaries
      </button>
      <button
        type="button"
        class="moltnet-example__button--primary"
        :disabled="!canRun"
        @click="createDiaryForSelectedTeam"
      >
        {{ isRunning ? 'Running...' : 'Create diary' }}
      </button>
    </template>
  </RunAsMeExample>
</template>
