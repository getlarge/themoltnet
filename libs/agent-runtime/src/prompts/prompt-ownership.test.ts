import {
  FREEFORM_TYPE,
  FULFILL_BRIEF_TYPE,
  RUN_EVAL_TYPE,
} from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import { makeFulfillBriefTask } from '../test-fixtures.js';
import { buildTaskUserPrompt } from './index.js';

const ctx = { diaryId: 'd1', taskId: 't1' };

describe('task prompt ownership', () => {
  it('renders typed task facts without generic runtime workflow prose', () => {
    const prompt = buildTaskUserPrompt(
      makeFulfillBriefTask({
        taskType: FULFILL_BRIEF_TYPE,
        input: { brief: 'Ship the profile migration.' },
      }),
      ctx,
    ).text;

    expect(prompt).toContain('Ship the profile migration.');
    expect(prompt).not.toContain('Proactive memory use');
    expect(prompt).not.toContain('Search MoltNet diary memory');
    expect(prompt).not.toContain('MoltNet-Diary: <id>');
    expect(prompt).not.toContain('Final output (read this carefully)');
    expect(prompt).not.toContain('submit_fulfill_brief_output');
  });

  it('keeps a freeform prompt bounded to its explicit task contract', () => {
    const prompt = buildTaskUserPrompt(
      makeFulfillBriefTask({
        taskType: FREEFORM_TYPE,
        input: {
          brief: 'Plan topics from the attached review manifest.',
          expectedOutput: 'A strict topic plan.',
          constraints: ['Use only the supplied manifest.'],
        },
      }),
      ctx,
    ).text;

    expect(prompt).toContain('Plan topics from the attached review manifest.');
    expect(prompt).toContain('Use only the supplied manifest.');
    expect(prompt).not.toContain('Search MoltNet diary memory');
    expect(prompt).not.toContain('moltnet_list_task_artifacts');
    expect(prompt).not.toContain('moltnet_upload_task_artifact');
    expect(prompt).not.toContain('submit_freeform_output');
  });

  it('does not leak generic verification or output sketches into run_eval', () => {
    const prompt = buildTaskUserPrompt(
      makeFulfillBriefTask({
        taskType: RUN_EVAL_TYPE,
        input: {
          scenario: { prompt: 'Respond with a concise answer.' },
          variantLabel: 'baseline',
          execution: { mode: 'vitro', workspace: 'none' },
          context: [],
          successCriteria: { version: 1 },
        },
      }),
      ctx,
    ).text;

    expect(prompt).toContain('Respond with a concise answer.');
    expect(prompt).not.toContain('## Self-verification');
    expect(prompt).not.toContain('RunEvalOutput');
    expect(prompt).not.toContain('Final output (read this carefully)');
  });
});
