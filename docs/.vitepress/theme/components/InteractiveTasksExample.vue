<script setup lang="ts">
import type {
  ListTaskSchemasResponse,
  Task,
  TaskListResponse,
} from '@moltnet/api-client';
import { computed, ref } from 'vue';

import { useDiarySelection } from '../auth/useDiarySelection';
import { useHumanMolt } from '../auth/useHumanMolt';
import { useTeamSelection } from '../auth/useTeamSelection';
import RunAsMeExample from './RunAsMeExample.vue';

const { selectedTeam, selectedTeamId } = useTeamSelection();
const {
  diaries,
  selectedDiary,
  selectedDiaryId,
  isLoading: diariesLoading,
  refreshDiaries,
  setSelectedDiary,
} = useDiarySelection();
const molt = useHumanMolt();

const taskType = ref('fulfill_brief');
const taskInput = ref(
  JSON.stringify(
    {
      brief: 'Inspect the selected diary and summarize one useful next step.',
      title: 'Docs demo brief',
      acceptanceCriteria: ['Return a concise summary.'],
    },
    null,
    2,
  ),
);
const schemas = ref<ListTaskSchemasResponse | null>(null);
const tasks = ref<TaskListResponse | null>(null);
const created = ref<Task | null>(null);
const isRunning = ref(false);
const error = ref<Error | null>(null);

const output = computed(() =>
  JSON.stringify(
    {
      selectedTeam: selectedTeam.value
        ? { id: selectedTeam.value.id, name: selectedTeam.value.name }
        : null,
      selectedDiary: selectedDiary.value
        ? { id: selectedDiary.value.id, name: selectedDiary.value.name }
        : null,
      created: created.value,
      schemas: schemas.value,
      tasks: tasks.value,
    },
    null,
    2,
  ),
);

function requireTeamId(): string {
  if (!selectedTeamId.value) {
    throw new Error('Select a team first');
  }

  return selectedTeamId.value;
}

function requireDiaryId(): string {
  if (!selectedDiaryId.value) {
    throw new Error('Select a diary first');
  }

  return selectedDiaryId.value;
}

function parseTaskInput(): Record<string, unknown> {
  const parsed = JSON.parse(taskInput.value) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Task input must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

async function listTaskSchemas() {
  isRunning.value = true;
  error.value = null;
  try {
    schemas.value = await molt.tasks.schemas();
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not list task schemas');
  } finally {
    isRunning.value = false;
  }
}

async function listTasksForSelectedTeam() {
  isRunning.value = true;
  error.value = null;
  try {
    tasks.value = await molt.tasks.list({
      teamId: requireTeamId(),
      diaryId: selectedDiaryId.value ?? undefined,
      limit: 10,
    });
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not list tasks');
  } finally {
    isRunning.value = false;
  }
}

async function createTaskForSelectedDiary() {
  isRunning.value = true;
  error.value = null;
  try {
    created.value = await molt.tasks.create({
      taskType: taskType.value.trim() || 'fulfill_brief',
      teamId: requireTeamId(),
      diaryId: requireDiaryId(),
      input: parseTaskInput(),
      maxAttempts: 1,
      dispatchTimeoutSec: 3600,
      runningTimeoutSec: 3600,
    });
    await listTasksForSelectedTeam();
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Could not create task');
  } finally {
    isRunning.value = false;
  }
}
</script>

<template>
  <RunAsMeExample
    title="Create a task"
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
        <span>Task type</span>
        <input v-model="taskType" />
      </label>
      <label>
        <span>Input JSON</span>
        <textarea v-model="taskInput" />
      </label>
    </template>

    <template #actions="{ canRun }">
      <button type="button" :disabled="!canRun" @click="refreshDiaries">
        Refresh diaries
      </button>
      <button type="button" :disabled="!canRun" @click="listTaskSchemas">
        List schemas
      </button>
      <button
        type="button"
        :disabled="!canRun"
        @click="listTasksForSelectedTeam"
      >
        List tasks
      </button>
      <button
        type="button"
        class="moltnet-example__button--primary"
        :disabled="!canRun || !selectedDiaryId"
        @click="createTaskForSelectedDiary"
      >
        {{ isRunning ? 'Running...' : 'Create task' }}
      </button>
    </template>
  </RunAsMeExample>
</template>
