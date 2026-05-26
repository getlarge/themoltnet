import type { SuccessCriteria } from '@moltnet/tasks';
import type { Agent } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createAssessTask, createTask } from './create-task.js';

const BASE_INPUT = {
  teamId: '11111111-1111-4111-8111-111111111111',
  diaryId: '22222222-2222-4222-8222-222222222222',
  correlationId: '33333333-3333-4333-8333-333333333333',
  referenceUrl: 'https://github.com/o/r/issues/9',
  title: 'Fix flaky test',
  brief: 'Issue body...',
};

function makeAgent() {
  const create = vi.fn().mockResolvedValue({
    id: 'task-1',
    correlationId: BASE_INPUT.correlationId,
  });
  return {
    agent: { tasks: { create } } as unknown as Agent,
    create,
  };
}

describe('createTask', () => {
  it('calls agent.tasks.create with the schema-correct body', async () => {
    const m = makeAgent();
    const out = await createTask({ agent: m.agent, ...BASE_INPUT });

    expect(out.id).toBe('task-1');
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create).toHaveBeenCalledWith({
      taskType: 'fulfill_brief',
      teamId: BASE_INPUT.teamId,
      diaryId: BASE_INPUT.diaryId,
      input: {
        brief: `Issue body...\n\nSource: ${BASE_INPUT.referenceUrl}`,
        title: 'Fix flaky test',
      },
      correlationId: BASE_INPUT.correlationId,
    });

    // Caller never has to think about references[] — the SDK enforces
    // the schema, and we deliberately don't pass that field for the
    // issue-mention path.
    const body = m.create.mock.calls[0][0] as Record<string, unknown>;
    expect(body.references).toBeUndefined();
  });

  it('does not duplicate the source URL when brief already mentions it', async () => {
    const m = makeAgent();
    await createTask({
      agent: m.agent,
      ...BASE_INPUT,
      brief: `Please fix ${BASE_INPUT.referenceUrl}`,
    });
    const body = m.create.mock.calls[0][0] as { input: { brief: string } };
    const occurrences =
      body.input.brief.split(BASE_INPUT.referenceUrl).length - 1;
    expect(occurrences).toBe(1);
  });

  it('omits title when not provided', async () => {
    const m = makeAgent();
    const { title: _omit, ...noTitle } = BASE_INPUT;
    void _omit;
    await createTask({ agent: m.agent, ...noTitle });
    const body = m.create.mock.calls[0][0] as { input: { title?: string } };
    expect(body.input.title).toBeUndefined();
  });

  it('propagates SDK errors verbatim', async () => {
    const create = vi.fn().mockRejectedValue(new Error('400 invalid teamId'));
    const agent = { tasks: { create } } as unknown as Agent;
    await expect(createTask({ agent, ...BASE_INPUT })).rejects.toThrow(
      /400.*invalid teamId/,
    );
  });

  it('forwards successCriteria when provided', async () => {
    const m = makeAgent();
    const sc: SuccessCriteria = {
      version: 1,
      gates: [],
      assertions: [],
      sideEffects: {},
    };
    await createTask({ agent: m.agent, ...BASE_INPUT, successCriteria: sc });
    const body = m.create.mock.calls[0][0] as {
      input: { successCriteria?: SuccessCriteria };
    };
    expect(body.input.successCriteria).toEqual(sc);
  });
});

const RUBRIC: SuccessCriteria = {
  version: 1,
  gates: [],
  assertions: [],
  rubric: {
    rubricId: 'assess-pr',
    version: 'v1',
    criteria: [
      {
        id: 'has-pr',
        description: 'opens a PR',
        weight: 1,
        scoring: 'boolean',
      },
    ],
  },
  sideEffects: {},
};

describe('createAssessTask', () => {
  it('calls agent.tasks.create with assess_brief shape + judged_work ref', async () => {
    const m = makeAgent();
    const out = await createAssessTask({
      agent: m.agent,
      teamId: BASE_INPUT.teamId,
      diaryId: BASE_INPUT.diaryId,
      correlationId: BASE_INPUT.correlationId,
      targetTaskId: '44444444-4444-4444-8444-444444444444',
      targetOutputCid: 'bafy-fulfill-output',
      successCriteria: RUBRIC,
    });

    expect(out.id).toBe('task-1');
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create).toHaveBeenCalledWith({
      taskType: 'assess_brief',
      teamId: BASE_INPUT.teamId,
      diaryId: BASE_INPUT.diaryId,
      input: {
        targetTaskId: '44444444-4444-4444-8444-444444444444',
        successCriteria: RUBRIC,
      },
      references: [
        {
          taskId: '44444444-4444-4444-8444-444444444444',
          outputCid: 'bafy-fulfill-output',
          role: 'judged_work',
        },
      ],
      correlationId: BASE_INPUT.correlationId,
    });
  });
});
