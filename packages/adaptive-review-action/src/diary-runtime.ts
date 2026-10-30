// Custom runtimes consume the daemon's published /pi adapter API.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  createPiDaemonAdapter,
  defaultPiRuntimeDefinition,
} from '@themoltnet/agent-daemon/pi';
import { definePiRuntime } from '@themoltnet/pi-runtime';

import { createReviewDiaryTools } from './diary-tools.js';

// Host configuration from the trusted workflow, never task or guest input.
const diaryIds: unknown = JSON.parse(
  process.env.ADAPTIVE_REVIEW_DIARY_IDS ?? '[]',
);
if (
  !Array.isArray(diaryIds) ||
  !diaryIds.every((id) => typeof id === 'string')
) {
  throw new Error(
    'ADAPTIVE_REVIEW_DIARY_IDS must be a JSON array of diary IDs',
  );
}

export default createPiDaemonAdapter(
  definePiRuntime({
    id: 'adaptive-review-diary',
    version: '1',
    runtimeKind: 'adaptive_review_pi',
    vm: defaultPiRuntimeDefinition.vm,
    hostCapabilities: defaultPiRuntimeDefinition.hostCapabilities,
    tools: createReviewDiaryTools(diaryIds),
  }),
);
