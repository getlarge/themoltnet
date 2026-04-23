import type { Task } from '@themoltnet/agent-runtime';
import { buildPromptForTask } from '@themoltnet/agent-runtime';
import { describe, expect, it } from 'vitest';

import { createMoltNetTools, type MoltNetToolsConfig } from './tools.js';

const noopConfig: MoltNetToolsConfig = {
  getAgent: () => null,
  getDiaryId: () => null,
  getSessionErrors: () => [],
  clearSessionErrors: () => {},
};

function exposedToolNames(): Set<string> {
  return new Set(createMoltNetTools(noopConfig).map((t) => t.name));
}

function promptToolRefs(prompt: string): Set<string> {
  return new Set(prompt.match(/moltnet_[a-z_]+/g) ?? []);
}

const ctx = { diaryId: 'd1', taskId: 't1' };

describe('pack-pipeline prompts only reference exposed tools', () => {
  const exposed = exposedToolNames();

  const tasks: Array<[string, Task]> = [
    [
      'curate_pack',
      {
        id: 't-c',
        task_type: 'curate_pack',
        diary_id: 'd1',
        status: 'running',
        output_kind: 'artifact',
        max_attempts: 1,
        accepted_attempt_n: null,
        cancel_reason: null,
        cancelled_by_agent_id: null,
        cancelled_by_human_id: null,
        completed_at: null,
        correlation_id: null,
        criteria_cid: null,
        expires_at: null,
        imposed_by_agent_id: null,
        imposed_by_human_id: null,
        input_cid: 'c',
        input_schema_cid: 'c',
        queued_at: '2026-04-21T00:00:00Z',
        references: [],
        team_id: 't',
        input: {
          diary_id: '00000000-0000-4000-8000-00000000000a',
          task_prompt: 'scope',
        },
      } as unknown as Task,
    ],
    [
      'render_pack',
      {
        id: 't-r',
        task_type: 'render_pack',
        diary_id: 'd1',
        status: 'running',
        output_kind: 'artifact',
        max_attempts: 1,
        accepted_attempt_n: null,
        cancel_reason: null,
        cancelled_by_agent_id: null,
        cancelled_by_human_id: null,
        completed_at: null,
        correlation_id: null,
        criteria_cid: null,
        expires_at: null,
        imposed_by_agent_id: null,
        imposed_by_human_id: null,
        input_cid: 'c',
        input_schema_cid: 'c',
        queued_at: '2026-04-21T00:00:00Z',
        references: [],
        team_id: 't',
        input: { pack_id: '00000000-0000-4000-8000-000000000000' },
      } as unknown as Task,
    ],
    [
      'judge_pack',
      {
        id: 't-j',
        task_type: 'judge_pack',
        diary_id: 'd1',
        status: 'running',
        output_kind: 'judgment',
        max_attempts: 1,
        accepted_attempt_n: null,
        cancel_reason: null,
        cancelled_by_agent_id: null,
        cancelled_by_human_id: null,
        completed_at: null,
        correlation_id: null,
        criteria_cid: null,
        expires_at: null,
        imposed_by_agent_id: null,
        imposed_by_human_id: null,
        input_cid: 'c',
        input_schema_cid: 'c',
        queued_at: '2026-04-21T00:00:00Z',
        references: [],
        team_id: 't',
        input: {
          source_pack_id: '00000000-0000-4000-8000-000000000000',
          rendered_pack_id: '00000000-0000-4000-8000-000000000001',
          rubric: {
            rubric_id: 'r',
            scope: 'packs',
            version: 'v1',
            preamble: 'p',
            criteria: [
              {
                id: 'coverage',
                description: 'd',
                weight: 1,
                scoring: 'deterministic_coverage_check',
              },
            ],
          },
        },
      } as unknown as Task,
    ],
  ];

  for (const [name, task] of tasks) {
    it(`${name} prompt references only tools exposed by createMoltNetTools`, () => {
      const prompt = buildPromptForTask(task, ctx);
      const refs = promptToolRefs(prompt);
      const missing = [...refs].filter((r) => !exposed.has(r));
      expect(
        missing,
        `Prompt references tools not exposed by pi-extension: ${missing.join(', ')}`,
      ).toEqual([]);
    });
  }
});
