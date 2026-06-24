import type { DiaryCatalog } from '@moltnet/api-client';
import { computed, readonly, ref, watch } from 'vue';

import { useHumanMolt } from './useHumanMolt';
import { useTeamSelection } from './useTeamSelection';

const selectedDiaryId = ref<string | null>(null);
const diaries = ref<DiaryCatalog[]>([]);
const isLoading = ref(false);
const error = ref<Error | null>(null);
let inflight: Promise<void> | null = null;

function chooseDefaultDiary(items: DiaryCatalog[]): string | null {
  if (
    selectedDiaryId.value &&
    items.some((diary) => diary.id === selectedDiaryId.value)
  ) {
    return selectedDiaryId.value;
  }

  return items[0]?.id ?? null;
}

export function useDiarySelection() {
  const { selectedTeamId } = useTeamSelection();
  const molt = useHumanMolt();

  function teamOptions() {
    if (!selectedTeamId.value) {
      throw new Error('Select a team first');
    }

    return { teamId: selectedTeamId.value };
  }

  async function refreshDiaries(): Promise<void> {
    if (!selectedTeamId.value) {
      diaries.value = [];
      selectedDiaryId.value = null;
      return;
    }

    if (inflight) return inflight;

    inflight = (async () => {
      isLoading.value = true;
      try {
        const result = await molt.diaries.list(undefined, teamOptions());
        diaries.value = result.items;
        selectedDiaryId.value = chooseDefaultDiary(result.items);
        error.value = null;
      } catch (err) {
        error.value =
          err instanceof Error ? err : new Error('Could not load diaries');
      } finally {
        isLoading.value = false;
        inflight = null;
      }
    })();

    return inflight;
  }

  const selectedDiary = computed(
    () =>
      diaries.value.find((diary) => diary.id === selectedDiaryId.value) ?? null,
  );

  function setSelectedDiary(diaryId: string): void {
    if (!diaries.value.some((diary) => diary.id === diaryId)) return;
    selectedDiaryId.value = diaryId;
  }

  watch(selectedTeamId, () => void refreshDiaries(), { immediate: true });

  return {
    diaries: readonly(diaries),
    selectedDiary,
    selectedDiaryId: readonly(selectedDiaryId),
    isLoading: readonly(isLoading),
    error: readonly(error),
    refreshDiaries,
    setSelectedDiary,
  };
}
