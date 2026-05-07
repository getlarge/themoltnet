import { ASSESS_BRIEF_TYPE } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import { makeFulfillBriefTask } from '../test-fixtures.js';
import { buildPromptForTask } from './index.js';

describe('buildPromptForTask', () => {
  const ctx = { diaryId: 'd1', taskId: 't1' };

  it('builds fulfill_brief prompt with brief text', () => {
    const task = makeFulfillBriefTask({
      input: {
        brief: 'Implement feature X',
        title: 'Feature X',
        scopeHint: 'misc',
      },
    });
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).toContain('Implement feature X');
    expect(prompt).toContain('t1');
  });

  it('rejects fulfill_brief with empty brief', () => {
    const task = makeFulfillBriefTask({
      input: { brief: '', title: 'x' },
    });
    expect(() => buildPromptForTask(task, ctx)).toThrow(/validation/);
  });

  it('builds assess_brief prompt with self-fetch instructions for the target task', () => {
    const targetTaskId = '11111111-1111-4111-8111-111111111111';
    const task = makeFulfillBriefTask({
      taskType: ASSESS_BRIEF_TYPE,
      input: {
        targetTaskId,
        successCriteria: {
          version: 1,
          rubric: {
            rubricId: 'r',
            version: 'v1',
            criteria: [
              {
                id: 'c1',
                description: 'Works',
                weight: 1,
                scoring: 'llm_score',
              },
            ],
          },
        },
      },
    });
    const prompt = buildPromptForTask(task, ctx);
    // The judge should be told the target's id and instructed to fetch
    // it via the MoltNet tools — no pre-resolved bundle required.
    expect(prompt).toContain(targetTaskId);
    expect(prompt).toContain('moltnet_get_task');
    expect(prompt).toContain('moltnet_list_task_attempts');
  });

  it('embeds correlation branch + trailer instructions when correlationId is set', () => {
    const correlationId = '22222222-3333-4444-8555-666666666666';
    const task = makeFulfillBriefTask({
      correlationId,
      input: { brief: 'do the thing', title: 'thing' },
    });
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).toContain(correlationId);
    expect(prompt).toContain(`moltnet/${correlationId}/<short-slug>`);
    expect(prompt).toContain(`Moltnet-Correlation-Id: ${correlationId}`);
  });

  it('omits the correlation section when correlationId is null', () => {
    const task = makeFulfillBriefTask({
      correlationId: null,
      input: { brief: 'no chain', title: 'x' },
    });
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).not.toContain('Moltnet-Correlation-Id');
    expect(prompt).not.toMatch(/^### Correlation/m);
  });

  it('throws on unknown taskType', () => {
    const task = makeFulfillBriefTask({ taskType: 'custom_type' });
    expect(() => buildPromptForTask(task, ctx)).toThrow(
      /No prompt builder registered/,
    );
  });
});
