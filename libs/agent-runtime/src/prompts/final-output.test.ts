import {
  ASSESS_BRIEF_TYPE,
  CURATE_PACK_TYPE,
  FULFILL_BRIEF_TYPE,
  JUDGE_PACK_TYPE,
  RENDER_PACK_TYPE,
  type Rubric,
  RUN_EVAL_TYPE,
} from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import { makeFulfillBriefTask } from '../test-fixtures.js';
import { buildFinalOutputBlock } from './final-output.js';
import { buildPromptForTask } from './index.js';

const ctx = { diaryId: 'd1', taskId: 't1' };

const rubric: Rubric = {
  rubricId: 'r1',
  version: 'v1',
  criteria: [{ id: 'c1', description: 'd', weight: 1, scoring: 'llm_score' }],
};

const TASK_FIXTURES: Array<{
  label: string;
  prompt: () => string;
  submitTool: string;
  schema: string;
}> = [
  {
    label: 'fulfill_brief',
    submitTool: 'submit_fulfill_brief_output',
    schema: 'FulfillBriefOutput',
    prompt: () =>
      buildPromptForTask(
        makeFulfillBriefTask({
          taskType: FULFILL_BRIEF_TYPE,
          input: { brief: 'do', title: 'x' },
        }),
        ctx,
      ),
  },
  {
    label: 'assess_brief',
    submitTool: 'submit_assess_brief_output',
    schema: 'AssessBriefOutput',
    prompt: () =>
      buildPromptForTask(
        makeFulfillBriefTask({
          taskType: ASSESS_BRIEF_TYPE,
          input: {
            targetTaskId: '11111111-1111-4111-8111-111111111111',
            successCriteria: { version: 1, rubric },
          },
        }),
        ctx,
      ),
  },
  {
    label: 'curate_pack',
    submitTool: 'submit_curate_pack_output',
    schema: 'CuratePackOutput',
    prompt: () =>
      buildPromptForTask(
        makeFulfillBriefTask({
          taskType: CURATE_PACK_TYPE,
          input: {
            diaryId: 'aaaaaaaa-0000-4000-8000-000000000001',
            taskPrompt: 'p',
          },
        }),
        ctx,
      ),
  },
  {
    label: 'render_pack',
    submitTool: 'submit_render_pack_output',
    schema: 'RenderPackOutput',
    prompt: () =>
      buildPromptForTask(
        makeFulfillBriefTask({
          taskType: RENDER_PACK_TYPE,
          input: { packId: 'bbbbbbbb-0000-4000-8000-000000000002' },
        }),
        ctx,
      ),
  },
  {
    label: 'judge_pack',
    submitTool: 'submit_judge_pack_output',
    schema: 'JudgePackOutput',
    prompt: () =>
      buildPromptForTask(
        makeFulfillBriefTask({
          taskType: JUDGE_PACK_TYPE,
          input: {
            renderedPackId: 'cccccccc-0000-4000-8000-000000000003',
            sourcePackId: 'dddddddd-0000-4000-8000-000000000004',
            successCriteria: { version: 1, rubric },
          },
        }),
        ctx,
      ),
  },
  {
    label: 'run_eval',
    submitTool: 'submit_run_eval_output',
    schema: 'RunEvalOutput',
    prompt: () =>
      buildPromptForTask(
        makeFulfillBriefTask({
          taskType: RUN_EVAL_TYPE,
          input: {
            scenario: { prompt: 'List 3 risks.' },
            variantLabel: 'baseline',
            context: [],
          },
        }),
        ctx,
      ),
  },
];

describe('buildFinalOutputBlock', () => {
  it('mentions submit tool first, JSON-fallback second, and the schema name', () => {
    const block = buildFinalOutputBlock({
      taskType: 'fulfill_brief',
      outputSchemaName: 'FulfillBriefOutput',
      shapeSketch: '{ "summary": "..." }',
    });
    expect(block).toMatch(/Final output \(read this carefully\)/);
    expect(block).toMatch(/submit_fulfill_brief_output/);
    expect(block).toMatch(/FulfillBriefOutput/);
    const submitIdx = block.indexOf('submit_fulfill_brief_output');
    const fallbackIdx = block.indexOf('Fallback');
    expect(submitIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(submitIdx);
    expect(block).toMatch(
      /Failing to report structured output as the very last action means the/,
    );
  });

  it('appends extra notes verbatim when provided', () => {
    const block = buildFinalOutputBlock({
      taskType: 'judge_pack',
      outputSchemaName: 'JudgePackOutput',
      shapeSketch: '{}',
      extraNotes: ['Custom warning line.'],
    });
    expect(block).toContain('Custom warning line.');
  });
});

describe('every task-type prompt ends with the strict final-output block', () => {
  for (const fx of TASK_FIXTURES) {
    it(`${fx.label} prompt mentions ${fx.submitTool} and ${fx.schema}`, () => {
      const prompt = fx.prompt();
      expect(prompt).toContain('Final output (read this carefully)');
      expect(prompt).toContain(fx.submitTool);
      expect(prompt).toContain(fx.schema);
      expect(prompt).toContain(
        'Failing to report structured output as the very last action means the',
      );
      // The block must be at the tail of the prompt — nothing else
      // overrides the closing instruction.
      const blockIdx = prompt.indexOf('Final output (read this carefully)');
      expect(prompt.slice(blockIdx)).not.toMatch(/##\s+\w/);
    });
  }
});
