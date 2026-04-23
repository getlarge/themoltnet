import {
  CURATE_PACK_TYPE,
  JUDGE_PACK_TYPE,
  RENDER_PACK_TYPE,
  type Rubric,
} from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import { makeFulfillBriefTask } from '../test-fixtures.js';
import { buildPromptForTask } from './index.js';

const ctx = { diaryId: 'd1', taskId: 't1' };

const testRubric: Rubric = {
  rubricId: 'pack-fidelity',
  version: 'v1',
  preamble: 'Evaluate faithfulness of the rendering to the source entries.',
  scope: 'packs',
  criteria: [
    {
      id: 'coverage',
      description: 'Every source entry is referenced',
      weight: 0.5,
      scoring: 'deterministic_coverage_check',
    },
    {
      id: 'grounding',
      description: 'No claims external to the source pack',
      weight: 0.5,
      scoring: 'llm_judged',
    },
  ],
};

describe('curate_pack prompt', () => {
  it('includes the task prompt, diary id, tag filters, and recipe', () => {
    const task = makeFulfillBriefTask({
      taskType: CURATE_PACK_TYPE,
      input: {
        diaryId: 'aaaaaaaa-0000-4000-8000-000000000001',
        taskPrompt: 'incidents related to CI pipelines',
        tagFilters: { include: ['scope:ci'], prefix: 'scope:' },
        recipe: 'topic-focused-v1',
      },
    });
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).toContain('incidents related to CI pipelines');
    expect(prompt).toContain('aaaaaaaa-0000-4000-8000-000000000001');
    expect(prompt).toContain('`scope:ci`');
    expect(prompt).toContain('`scope:`');
    expect(prompt).toContain('topic-focused-v1');
    expect(prompt).toContain('moltnet_pack_create');
    expect(prompt).toContain('checkpoints');
    expect(prompt).toContain('t1');
  });

  it('rejects curate_pack with empty taskPrompt', () => {
    const task = makeFulfillBriefTask({
      taskType: CURATE_PACK_TYPE,
      input: {
        diaryId: 'aaaaaaaa-0000-4000-8000-000000000001',
        taskPrompt: '',
      },
    });
    expect(() => buildPromptForTask(task, ctx)).toThrow(/validation/);
  });
});

describe('render_pack prompt', () => {
  it('mentions the pack id, persist/pinned flags, and pack_render', () => {
    const task = makeFulfillBriefTask({
      taskType: RENDER_PACK_TYPE,
      input: {
        packId: 'bbbbbbbb-0000-4000-8000-000000000002',
        persist: true,
        pinned: false,
      },
    });
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).toContain('bbbbbbbb-0000-4000-8000-000000000002');
    expect(prompt).toContain('moltnet_pack_render');
    expect(prompt).toContain('Persist**: `true`');
    expect(prompt).toContain('Pinned**: `false`');
  });

  it('rejects render_pack with non-uuid pack id', () => {
    const task = makeFulfillBriefTask({
      taskType: RENDER_PACK_TYPE,
      input: { packId: 'not-a-uuid' },
    });
    expect(() => buildPromptForTask(task, ctx)).toThrow(/validation/);
  });
});

describe('judge_pack prompt', () => {
  it('lists every rubric criterion with weight and scoring mode', () => {
    const task = makeFulfillBriefTask({
      taskType: JUDGE_PACK_TYPE,
      input: {
        renderedPackId: 'cccccccc-0000-4000-8000-000000000003',
        sourcePackId: 'dddddddd-0000-4000-8000-000000000004',
        rubric: testRubric,
      },
    });
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).toContain('cccccccc-0000-4000-8000-000000000003');
    expect(prompt).toContain('dddddddd-0000-4000-8000-000000000004');
    expect(prompt).toContain('pack-fidelity');
    expect(prompt).toContain('coverage');
    expect(prompt).toContain('grounding');
    expect(prompt).toContain('deterministic_coverage_check');
    expect(prompt).toContain('llm_judged');
    expect(prompt).toContain('rubric:pack-fidelity');
    expect(prompt).toContain(
      'Evaluate faithfulness of the rendering to the source entries.',
    );
  });

  it('rejects judge_pack with empty criteria array', () => {
    const task = makeFulfillBriefTask({
      taskType: JUDGE_PACK_TYPE,
      input: {
        renderedPackId: 'cccccccc-0000-4000-8000-000000000003',
        sourcePackId: 'dddddddd-0000-4000-8000-000000000004',
        rubric: {
          rubricId: 'empty',
          version: 'v1',
          criteria: [],
        },
      },
    });
    expect(() => buildPromptForTask(task, ctx)).toThrow(/validation/);
  });
});
