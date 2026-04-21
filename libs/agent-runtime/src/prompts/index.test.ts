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
        scope_hint: 'misc',
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

  it('rejects assess_brief without a target in extras', () => {
    const task = makeFulfillBriefTask({
      task_type: ASSESS_BRIEF_TYPE,
      input: {
        target_task_id: '11111111-1111-4111-8111-111111111111',
        criteria: [
          { id: 'c1', description: 'Works', weight: 1, scoring: 'llm_judged' },
        ],
      },
    });
    expect(() => buildPromptForTask(task, ctx)).toThrow(/target/);
  });

  it('throws on unknown task_type', () => {
    const task = makeFulfillBriefTask({ task_type: 'custom_type' });
    expect(() => buildPromptForTask(task, ctx)).toThrow(
      /No prompt builder registered/,
    );
  });
});
