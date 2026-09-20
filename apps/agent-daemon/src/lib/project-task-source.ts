import { ApiTaskSource, PollingApiTaskSource } from '@themoltnet/agent-runtime';

import type { EffectiveRunProjectSelection } from './run-project-selection.js';

type RunSelection = Pick<EffectiveRunProjectSelection, 'projectId'>;
type OnceOptions = Omit<
  ConstructorParameters<typeof ApiTaskSource>[0],
  'projectId'
>;
type PollOptions = Omit<
  ConstructorParameters<typeof PollingApiTaskSource>[0],
  'projectId'
>;

// The run owns the project declaration, including an explicit null for General.
// Source options cannot replace it independently of the pinned run selection.
export function createProjectOnceSource(
  selection: RunSelection,
  options: OnceOptions,
): ApiTaskSource {
  return new ApiTaskSource({ ...options, projectId: selection.projectId });
}
export function createProjectPollingSource(
  selection: RunSelection,
  options: PollOptions,
): PollingApiTaskSource {
  return new PollingApiTaskSource({
    ...options,
    projectId: selection.projectId,
  });
}
