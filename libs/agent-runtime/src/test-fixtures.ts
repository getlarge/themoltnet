import type { Task } from '@moltnet/tasks';
import { FULFILL_BRIEF_TYPE } from '@moltnet/tasks';

export function makeFulfillBriefTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    taskType: FULFILL_BRIEF_TYPE,
    teamId: '22222222-2222-4222-8222-222222222222',
    diaryId: null,
    outputKind: 'artifact',
    input: {
      brief: 'Test brief',
      title: 'Test',
      scopeHint: 'misc',
    },
    inputSchemaCid: 'cid-placeholder-input-schema',
    inputCid: 'cid-placeholder-input',
    criteriaCid: null,
    references: [],
    correlationId: null,
    imposedByAgentId: null,
    imposedByHumanId: null,
    acceptedAttemptN: null,
    requiredExecutorTrustLevel: 'selfDeclared',
    status: 'running',
    queuedAt: new Date('2026-04-01T00:00:00Z').toISOString(),
    completedAt: null,
    expiresAt: null,
    cancelledByAgentId: null,
    cancelledByHumanId: null,
    cancelReason: null,
    maxAttempts: 1,
    dispatchTimeoutSec: null,
    runningTimeoutSec: null,
    ...overrides,
  };
}
