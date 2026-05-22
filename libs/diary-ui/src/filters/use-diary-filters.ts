import { useCallback, useMemo, useState } from 'react';

import { type DiaryFilterState, EMPTY_FILTER_STATE } from '../types.js';
import { serializeDiaryFiltersToQuery } from './url.js';

export interface UseDiaryFiltersResult {
  state: DiaryFilterState;
  set: (
    next: DiaryFilterState | ((prev: DiaryFilterState) => DiaryFilterState),
  ) => void;
  patch: (partial: Partial<DiaryFilterState>) => void;
  reset: () => void;
  queryString: string;
}

export function useDiaryFilters(
  initial: DiaryFilterState = EMPTY_FILTER_STATE,
): UseDiaryFiltersResult {
  const [state, setState] = useState<DiaryFilterState>(initial);

  const set = useCallback<UseDiaryFiltersResult['set']>((next) => {
    setState((prev) =>
      typeof next === 'function'
        ? (next as (p: DiaryFilterState) => DiaryFilterState)(prev)
        : next,
    );
  }, []);

  const patch = useCallback((partial: Partial<DiaryFilterState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const reset = useCallback(() => {
    setState(EMPTY_FILTER_STATE);
  }, []);

  const queryString = useMemo(
    () => serializeDiaryFiltersToQuery(state),
    [state],
  );

  return { state, set, patch, reset, queryString };
}
