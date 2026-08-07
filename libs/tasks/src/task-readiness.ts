export type UsefulTaskEventKind = 'text_delta' | 'tool_call_start';

export interface TaskEventCandidate {
  kind: string;
  payload: Record<string, unknown>;
}

/** Select the first event that proves the model has done useful work. */
export function firstUsefulTaskEvent(
  events: readonly TaskEventCandidate[],
): { index: number; kind: UsefulTaskEventKind } | null {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.kind === 'tool_call_start') {
      return { index, kind: event.kind };
    }
    if (
      event.kind === 'text_delta' &&
      typeof event.payload['delta'] === 'string' &&
      event.payload['delta'].trim().length > 0
    ) {
      return { index, kind: event.kind };
    }
  }
  return null;
}
