import type { TaskAttemptSummary, TaskMessage, TaskSummary } from '../types.js';

export const taskFixture: TaskSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  taskType: 'curate_pack',
  teamId: '22222222-2222-4222-8222-222222222222',
  diaryId: '33333333-3333-4333-8333-333333333333',
  outputKind: 'artifact',
  input: {
    diaryId: '33333333-3333-4333-8333-333333333333',
    taskPrompt: 'Curate issue 940 task UI context',
  },
  inputSchemaCid: 'bafy-schema',
  inputCid: 'bafy-input',
  criteriaCid: null,
  references: [
    {
      taskId: '44444444-4444-4444-8444-444444444444',
      outputCid: 'bafy-ref',
      role: 'context',
    },
  ],
  correlationId: null,
  imposedByAgentId: '55555555-5555-4555-8555-555555555555',
  imposedByHumanId: null,
  acceptedAttemptN: null,
  requiredExecutorTrustLevel: 'selfDeclared',
  status: 'running',
  queuedAt: '2026-04-27T10:00:00.000Z',
  completedAt: null,
  expiresAt: '2026-04-28T10:00:00.000Z',
  cancelledByAgentId: null,
  cancelledByHumanId: null,
  cancelReason: null,
  maxAttempts: 2,
  dispatchTimeoutSec: 300,
  runningTimeoutSec: 7200,
  consoleUrl:
    'https://console.themolt.net/tasks/11111111-1111-4111-8111-111111111111',
};

export const attemptFixture: TaskAttemptSummary = {
  taskId: taskFixture.id,
  attemptN: 1,
  claimedByAgentId: '55555555-5555-4555-8555-555555555555',
  runtimeId: '66666666-6666-4666-8666-666666666666',
  claimedAt: '2026-04-27T10:01:00.000Z',
  startedAt: '2026-04-27T10:02:00.000Z',
  completedAt: null,
  status: 'running',
  output: null,
  outputCid: null,
  claimedExecutorFingerprint: 'ABCD-EFGH',
  claimedExecutorManifest: null,
  completedExecutorFingerprint: null,
  completedExecutorManifest: null,
  error: null,
  usage: {
    inputTokens: 120,
    outputTokens: 42,
    toolCalls: 3,
    model: 'gpt-test',
    provider: 'openai',
  },
  contentSignature: null,
  signedAt: null,
};

export const messagesFixture: TaskMessage[] = [
  {
    taskId: taskFixture.id,
    attemptN: 1,
    seq: 0,
    timestamp: '2026-04-27T10:02:00.000Z',
    kind: 'text_delta',
    payload: { text: 'Reading ' },
  },
  {
    taskId: taskFixture.id,
    attemptN: 1,
    seq: 1,
    timestamp: '2026-04-27T10:02:01.000Z',
    kind: 'text_delta',
    payload: { text: 'task context.' },
  },
  {
    taskId: taskFixture.id,
    attemptN: 1,
    seq: 2,
    timestamp: '2026-04-27T10:02:02.000Z',
    kind: 'tool_call_start',
    payload: { name: 'entries_search', args: { q: 'task ui' } },
  },
];
