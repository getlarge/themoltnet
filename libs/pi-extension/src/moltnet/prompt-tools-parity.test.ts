import type { Task } from '@themoltnet/agent-runtime';
import { buildPromptForTask } from '@themoltnet/agent-runtime';
import { describe, expect, it } from 'vitest';

import { createMoltNetTools, type MoltNetToolsConfig } from './tools.js';

const noopConfig: MoltNetToolsConfig = {
  getAgent: () => null,
  getDiaryId: () => null,
  getTeamId: () => null,
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
        taskType: 'curate_pack',
        diaryId: 'd1',
        status: 'running',
        outputKind: 'artifact',
        maxAttempts: 1,
        acceptedAttemptN: null,
        cancelReason: null,
        cancelledByAgentId: null,
        cancelledByHumanId: null,
        completedAt: null,
        correlationId: null,
        criteriaCid: null,
        expiresAt: null,
        imposedByAgentId: null,
        imposedByHumanId: null,
        inputCid: 'c',
        inputSchemaCid: 'c',
        queuedAt: '2026-04-21T00:00:00Z',
        references: [],
        teamId: 't',
        input: {
          diaryId: '00000000-0000-4000-8000-00000000000a',
          taskPrompt: 'scope',
        },
      } as unknown as Task,
    ],
    [
      'render_pack',
      {
        id: 't-r',
        taskType: 'render_pack',
        diaryId: 'd1',
        status: 'running',
        outputKind: 'artifact',
        maxAttempts: 1,
        acceptedAttemptN: null,
        cancelReason: null,
        cancelledByAgentId: null,
        cancelledByHumanId: null,
        completedAt: null,
        correlationId: null,
        criteriaCid: null,
        expiresAt: null,
        imposedByAgentId: null,
        imposedByHumanId: null,
        inputCid: 'c',
        inputSchemaCid: 'c',
        queuedAt: '2026-04-21T00:00:00Z',
        references: [],
        teamId: 't',
        input: { packId: '00000000-0000-4000-8000-000000000000' },
      } as unknown as Task,
    ],
    [
      'judge_pack',
      {
        id: 't-j',
        taskType: 'judge_pack',
        diaryId: 'd1',
        status: 'running',
        outputKind: 'judgment',
        maxAttempts: 1,
        acceptedAttemptN: null,
        cancelReason: null,
        cancelledByAgentId: null,
        cancelledByHumanId: null,
        completedAt: null,
        correlationId: null,
        criteriaCid: null,
        expiresAt: null,
        imposedByAgentId: null,
        imposedByHumanId: null,
        inputCid: 'c',
        inputSchemaCid: 'c',
        queuedAt: '2026-04-21T00:00:00Z',
        references: [],
        teamId: 't',
        input: {
          sourcePackId: '00000000-0000-4000-8000-000000000000',
          renderedPackId: '00000000-0000-4000-8000-000000000001',
          rubric: {
            rubricId: 'r',
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
