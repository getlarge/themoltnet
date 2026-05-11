<script setup lang="ts">
import type {
  ContextPackResponseListWithRendered,
  CustomPackResult,
  DiaryEntry,
} from '@moltnet/api-client';
import { computed, ref } from 'vue';

import { useDiarySelection } from '../auth/useDiarySelection';
import { useHumanMolt } from '../auth/useHumanMolt';
import RunAsMeExample from './RunAsMeExample.vue';

const {
  diaries,
  selectedDiary,
  selectedDiaryId,
  isLoading: diariesLoading,
  refreshDiaries,
  setSelectedDiary,
} = useDiarySelection();
const molt = useHumanMolt();

const prompt = ref('Entries created from the interactive docs');
const packs = ref<ContextPackResponseListWithRendered['items']>([]);
const entries = ref<DiaryEntry[]>([]);
const created = ref<CustomPackResult | null>(null);
const isRunning = ref(false);
const error = ref<Error | null>(null);

const output = computed(() =>
  JSON.stringify(
    {
      selectedDiary: selectedDiary.value
        ? { id: selectedDiary.value.id, name: selectedDiary.value.name }
        : null,
      created: created.value,
      packs: packs.value,
      candidateEntries: entries.value,
    },
    null,
    2,
  ),
);

function requireDiaryId(): string {
  if (!selectedDiaryId.value) {
    throw new Error('Select a diary first');
  }

  return selectedDiaryId.value;
}

async function listPacksForSelectedDiary() {
  isRunning.value = true;
  error.value = null;
  try {
    const result = await molt.packs.list({ diaryId: requireDiaryId() });
    packs.value = result.items;
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not list packs');
  } finally {
    isRunning.value = false;
  }
}

async function loadCandidateEntries(): Promise<DiaryEntry[]> {
  const result = await molt.entries.list(requireDiaryId(), { limit: 5 });
  entries.value = result.items;
  return result.items;
}

async function listCandidateEntries() {
  isRunning.value = true;
  error.value = null;
  try {
    await loadCandidateEntries();
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not list entries');
  } finally {
    isRunning.value = false;
  }
}

async function createPackFromLatestEntries() {
  isRunning.value = true;
  error.value = null;
  try {
    const candidates =
      entries.value.length > 0 ? entries.value : await loadCandidateEntries();
    const selectedEntries = candidates.slice(0, 3);

    if (selectedEntries.length === 0) {
      throw new Error('Create at least one entry in this diary first');
    }

    created.value = await molt.packs.create(requireDiaryId(), {
      packType: 'custom',
      params: {
        prompt: prompt.value.trim() || 'Interactive docs pack',
        source: 'docs-run-as-me',
      },
      entries: selectedEntries.map((entry, index) => ({
        entryId: entry.id,
        rank: index + 1,
      })),
      tokenBudget: 2000,
    });
    await listPacksForSelectedDiary();
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not create pack');
  } finally {
    isRunning.value = false;
  }
}
</script>

<template>
  <RunAsMeExample
    title="Create a context pack"
    :output="output"
    :error="error"
    :is-running="isRunning || diariesLoading"
  >
    <template #fields>
      <label>
        <span>Diary</span>
        <select
          :value="selectedDiaryId ?? ''"
          :disabled="diariesLoading"
          @change="setSelectedDiary(($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>
            {{ diariesLoading ? 'Loading diaries...' : 'Select a diary' }}
          </option>
          <option v-for="diary in diaries" :key="diary.id" :value="diary.id">
            {{ diary.name }}
          </option>
        </select>
      </label>
      <label>
        <span>Pack prompt</span>
        <textarea v-model="prompt" />
      </label>
    </template>

    <template #actions="{ canRun }">
      <button type="button" :disabled="!canRun" @click="refreshDiaries">
        Refresh diaries
      </button>
      <button
        type="button"
        :disabled="!canRun || !selectedDiaryId"
        @click="listPacksForSelectedDiary"
      >
        List packs
      </button>
      <button
        type="button"
        :disabled="!canRun || !selectedDiaryId"
        @click="listCandidateEntries"
      >
        Load entries
      </button>
      <button
        type="button"
        class="moltnet-example__button--primary"
        :disabled="!canRun || !selectedDiaryId"
        @click="createPackFromLatestEntries"
      >
        {{ isRunning ? 'Running...' : 'Create pack' }}
      </button>
    </template>
  </RunAsMeExample>
</template>
