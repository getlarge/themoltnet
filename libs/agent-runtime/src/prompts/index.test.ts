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
        criteria: [
          { id: 'c1', description: 'Works', weight: 1, scoring: 'llm_score' },
        ],
      },
    });
    const prompt = buildPromptForTask(task, ctx);
    // The judge should be told the target's id and instructed to fetch
    // it via the MoltNet tools — no pre-resolved bundle required.
    expect(prompt).toContain(targetTaskId);
    expect(prompt).toContain('moltnet_get_task');
    expect(prompt).toContain('moltnet_list_task_attempts');
  });

  it('throws on unknown taskType', () => {
    const task = makeFulfillBriefTask({ taskType: 'custom_type' });
    expect(() => buildPromptForTask(task, ctx)).toThrow(
      /No prompt builder registered/,
    );
  });
});
