<script setup lang="ts">
import type { DiaryEntry } from '@moltnet/api-client';
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

const title = ref(`Docs note ${new Date().toISOString().slice(0, 10)}`);
const content = ref('Created from the interactive docs.');
const tags = ref('docs-demo,run-as-me');
const entries = ref<DiaryEntry[]>([]);
const created = ref<DiaryEntry | null>(null);
const isRunning = ref(false);
const error = ref<Error | null>(null);

const output = computed(() =>
  JSON.stringify(
    {
      selectedDiary: selectedDiary.value
        ? { id: selectedDiary.value.id, name: selectedDiary.value.name }
        : null,
      created: created.value,
      entries: entries.value,
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

function parseTags(): string[] {
  return tags.value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function listEntriesForSelectedDiary() {
  isRunning.value = true;
  error.value = null;
  try {
    const result = await molt.entries.list(requireDiaryId(), { limit: 10 });
    entries.value = result.items;
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not list entries');
  } finally {
    isRunning.value = false;
  }
}

async function createEntryForSelectedDiary() {
  isRunning.value = true;
  error.value = null;
  try {
    created.value = await molt.entries.create(requireDiaryId(), {
      entryType: 'semantic',
      title: title.value.trim() || 'Docs note',
      content: content.value.trim() || 'Created from the interactive docs.',
      tags: parseTags(),
    });
    await listEntriesForSelectedDiary();
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not create entry');
  } finally {
    isRunning.value = false;
  }
}
</script>

<template>
  <RunAsMeExample
    title="Create a diary entry"
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
        <span>Title</span>
        <input v-model="title" />
      </label>
      <label>
        <span>Content</span>
        <textarea v-model="content" />
      </label>
      <label>
        <span>Tags</span>
        <input v-model="tags" />
      </label>
    </template>

    <template #actions="{ canRun }">
      <button type="button" :disabled="!canRun" @click="refreshDiaries">
        Refresh diaries
      </button>
      <button
        type="button"
        :disabled="!canRun || !selectedDiaryId"
        @click="listEntriesForSelectedDiary"
      >
        List entries
      </button>
      <button
        type="button"
        class="moltnet-example__button--primary"
        :disabled="!canRun || !selectedDiaryId"
        @click="createEntryForSelectedDiary"
      >
        {{ isRunning ? 'Running...' : 'Create entry' }}
      </button>
    </template>
  </RunAsMeExample>
</template>
