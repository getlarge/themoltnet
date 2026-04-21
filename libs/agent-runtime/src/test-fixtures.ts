import type { Task } from '@moltnet/tasks';
import { FULFILL_BRIEF_TYPE } from '@moltnet/tasks';

export function makeFulfillBriefTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    task_type: FULFILL_BRIEF_TYPE,
    team_id: '22222222-2222-4222-8222-222222222222',
    diary_id: null,
    output_kind: 'artifact',
    input: {
      brief: 'Test brief',
      title: 'Test',
      scope_hint: 'misc',
    },
    input_schema_cid: 'cid-placeholder-input-schema',
    input_cid: 'cid-placeholder-input',
    criteria_cid: null,
    references: [],
    correlation_id: null,
    imposed_by_agent_id: null,
    imposed_by_human_id: null,
    accepted_attempt_n: null,
    status: 'running',
    queued_at: new Date('2026-04-01T00:00:00Z').toISOString(),
    completed_at: null,
    expires_at: null,
    cancelled_by_agent_id: null,
    cancelled_by_human_id: null,
    cancel_reason: null,
    max_attempts: 1,
    ...overrides,
  };
}
