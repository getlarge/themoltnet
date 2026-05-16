import {
  ASSESS_BRIEF_TYPE,
  JUDGE_EVAL_ATTEMPT_TYPE,
  PR_REVIEW_TYPE,
} from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import { makeFulfillBriefTask } from '../test-fixtures.js';
import { buildTaskUserPrompt } from './index.js';

describe('buildTaskUserPrompt', () => {
  const ctx = { diaryId: 'd1', taskId: 't1' };

  it('builds fulfill_brief prompt with brief text', () => {
    const task = makeFulfillBriefTask({
      input: {
        brief: 'Implement feature X',
        title: 'Feature X',
        scopeHint: 'misc',
      },
    });
    const prompt = buildTaskUserPrompt(task, ctx);
    expect(prompt).toContain('Implement feature X');
    expect(prompt).toContain('t1');
  });

  it('rejects fulfill_brief with empty brief', () => {
    const task = makeFulfillBriefTask({
      input: { brief: '', title: 'x' },
    });
    expect(() => buildTaskUserPrompt(task, ctx)).toThrow(/validation/);
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
    const prompt = buildTaskUserPrompt(task, ctx);
    // The judge should be told the target's id and instructed to fetch
    // it via the MoltNet tools — no pre-resolved bundle required.
    expect(prompt).toContain(targetTaskId);
    expect(prompt).toContain('moltnet_get_task');
    expect(prompt).toContain('moltnet_list_task_attempts');
  });

  it('builds judge_eval_attempt prompt with attempt-message inspection instructions', () => {
    const task = makeFulfillBriefTask({
      taskType: JUDGE_EVAL_ATTEMPT_TYPE,
      input: {
        targetTaskId: '11111111-1111-4111-8111-111111111111',
        targetAttemptN: 1,
        successCriteria: {
          version: 1,
          rubric: {
            rubricId: 'r',
            version: 'v1',
            criteria: [
              {
                id: 'c1',
                description: 'Uses the right command path',
                weight: 1,
                scoring: 'llm_checklist',
              },
            ],
          },
        },
      },
    });
    const prompt = buildTaskUserPrompt(task, ctx);
    expect(prompt).toContain('moltnet_list_task_attempts');
    expect(prompt).toContain('moltnet_list_task_messages');
    expect(prompt).toContain('Do not delegate');
  });
  it('mentions the dedicated review worktree for assess_brief when provided by the executor', () => {
    const task = makeFulfillBriefTask({
      taskType: ASSESS_BRIEF_TYPE,
      input: {
        targetTaskId: '11111111-1111-4111-8111-111111111111',
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
    const prompt = buildTaskUserPrompt(task, {
      ...ctx,
      workspace: {
        mode: 'dedicated_worktree',
        branch: 'task/assess-brief-11111111',
      },
    });
    expect(prompt).toContain('### Workspace');
    expect(prompt).toContain('dedicated disposable git');
    expect(prompt).toContain('If you need to check out the target');
    expect(prompt).toContain('task/assess-brief-11111111');
  });

  it('builds a generic pr_review prompt without GitHub-specific runtime assumptions', () => {
    const task = makeFulfillBriefTask({
      taskType: PR_REVIEW_TYPE,
      input: {
        subject: {
          title: 'Generated change review',
          summary: 'Review this change artifact for complexity.',
          resourceUrls: ['https://example.test/review/123'],
          inspectionHints: ['Inspect the local checkout before scoring.'],
        },
        taskPrompt:
          'Use the consumer-supplied review flow and publish the review before final output.',
        successCriteria: {
          version: 1,
          rubric: {
            rubricId: 'pr-complexity-binary',
            version: 'v1',
            criteria: [
              {
                id: 'c1',
                description: 'Works',
                weight: 1,
                scoring: 'boolean',
              },
            ],
          },
        },
      },
    });
    const prompt = buildTaskUserPrompt(task, ctx);
    expect(prompt).toContain('Generated change review');
    expect(prompt).toContain('https://example.test/review/123');
    expect(prompt).toContain('submit_pr_review_output');
    expect(prompt).toContain('task-specific instructions');
    expect(prompt).toContain(
      'Use the consumer-supplied review flow and publish the review before final output.',
    );
    expect(prompt).not.toContain('gh pr diff');
  });

  it('embeds correlation branch + trailer instructions when correlationId is set', () => {
    const correlationId = '22222222-3333-4444-8555-666666666666';
    const task = makeFulfillBriefTask({
      correlationId,
      input: { brief: 'do the thing', title: 'thing' },
    });
    const prompt = buildTaskUserPrompt(task, ctx);
    expect(prompt).toContain(correlationId);
    expect(prompt).toContain(`moltnet/${correlationId}/<short-slug>`);
    expect(prompt).toContain(`Moltnet-Correlation-Id: ${correlationId}`);
  });

  it('mentions the dedicated worktree branch when provided by the executor', () => {
    const correlationId = '22222222-3333-4444-8555-666666666666';
    const task = makeFulfillBriefTask({
      correlationId,
      input: { brief: 'do the thing', title: 'thing' },
    });
    const prompt = buildTaskUserPrompt(task, {
      ...ctx,
      workspace: {
        mode: 'dedicated_worktree',
        branch: `moltnet/${correlationId}/thing`,
      },
    });
    expect(prompt).toContain('### Workspace');
    expect(prompt).toContain('dedicated git worktree');
    expect(prompt).toContain(`moltnet/${correlationId}/thing`);
    expect(prompt).toContain('already-provisioned dedicated worktree branch');
  });

  it('omits the correlation section when correlationId is null', () => {
    const task = makeFulfillBriefTask({
      correlationId: null,
      input: { brief: 'no chain', title: 'x' },
    });
    const prompt = buildTaskUserPrompt(task, ctx);
    expect(prompt).not.toContain('Moltnet-Correlation-Id');
    expect(prompt).not.toMatch(/^### Correlation/m);
  });

  it('throws on unknown taskType', () => {
    const task = makeFulfillBriefTask({ taskType: 'custom_type' });
    expect(() => buildTaskUserPrompt(task, ctx)).toThrow(
      /No prompt builder registered/,
    );
  });
});
