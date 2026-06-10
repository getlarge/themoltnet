import { describe, expect, it } from 'vitest';

import { buildRunEvalUserPrompt } from './run-eval.js';

const baseInput = {
  scenario: { prompt: 'List the top 3 risks in this code.' },
  variantLabel: 'with-skill',
  execution: { mode: 'vitro' as const, workspace: 'none' as const },
  context: [],
};

const ctx = { diaryId: 'd-1', taskId: 't-1' };

const render = (
  input: Parameters<typeof buildRunEvalUserPrompt>[0],
  c: Parameters<typeof buildRunEvalUserPrompt>[1] = ctx,
) => buildRunEvalUserPrompt(input, c).text;

describe('buildRunEvalUserPrompt', () => {
  it('embeds the scenario prompt verbatim', () => {
    expect(render(baseInput)).toContain('List the top 3 risks in this code.');
  });

  it('includes the variantLabel for traceability', () => {
    expect(render(baseInput)).toContain('with-skill');
  });

  it('includes the task id (agent must echo it)', () => {
    expect(render(baseInput)).toContain('t-1');
  });

  it('omits the self-verification block when no successCriteria', () => {
    // The heading `## Self-verification` is only emitted by the
    // self-verification block itself; the final-output block mentions
    // the word in its prose but never as a heading.
    expect(render(baseInput)).not.toContain('## Self-verification');
  });

  it('includes the self-verification block when successCriteria present', () => {
    const out = render({
      ...baseInput,
      successCriteria: { version: 1 as const },
    });
    expect(out).toContain('## Self-verification');
    expect(out).toContain('part of the promise you made when you claimed');
    expect(out).toContain('`verification` MUST be a JSON object');
    expect(out).toContain('Minimal valid example:');
  });

  it('lists scenario inputFiles when present', () => {
    const out = render({
      ...baseInput,
      scenario: { prompt: 'x', inputFiles: ['a.md'] },
    });
    expect(out).toContain('a.md');
  });

  it('always emits the final-output block', () => {
    expect(render(baseInput)).toContain('RunEvalOutput');
  });

  it('shows verification as an object in the final output sketch', () => {
    const out = render({
      ...baseInput,
      successCriteria: { version: 1 as const },
    });
    expect(out).toContain('"verification": {');
    expect(out).toContain('must be an object, never a string');
  });

  it('omits the discipline section when no task context exists', () => {
    expect(render(baseInput)).not.toContain('## Injected Task Context');
  });

  it('requires reconciling injected context INTO the code (not into comments)', () => {
    const out = render({
      ...baseInput,
      context: [
        {
          slug: 'ctx-pack',
          binding: 'context_inline' as const,
          content: '# Context Pack',
        },
      ],
    });
    // Section uses the exact phrase "Injected Task Context" so weaker
    // models see one anchor repeated between this heading and the
    // materialized context block header.
    expect(out).toContain('## Injected Task Context');
    expect(out).toContain('MUST inspect it BEFORE you write solution files');
    // The reconciliation rule is explicit: code, not comments.
    expect(out).toContain('Reconcile every constraint from that context');
    expect(out).toContain('into the code path');
    expect(out).toContain('Quoting a constraint back in a comment');
    expect(out).toContain('NOT following the task');
    // Inline-context path still names the materialized files.
    expect(out).toContain('context-pack.md');
    expect(out).toContain('AGENTS.md');
  });

  it('does NOT leak the judge rubric or judge-only sections', () => {
    // RunEvalSuccessCriteria intentionally excludes `rubric` so the
    // producer cannot see the judge's answer key. Assert the rendered
    // prompt and trace reflect that contract.
    const assembled = buildRunEvalUserPrompt(
      { ...baseInput, successCriteria: { version: 1 as const } },
      ctx,
    );
    const out = assembled.text;
    expect(out).not.toContain('## Rubric');
    expect(out).not.toContain('## Criteria');
    expect(out).not.toMatch(/\| Criterion \| Weight \|/);
    expect(out).not.toContain('Composite arithmetic');
    expect(
      assembled.trace.find((t) => t.source === 'rubric_judge'),
    ).toBeUndefined();
  });

  it('exposes a structured per-section trace alongside the text', () => {
    const assembled = buildRunEvalUserPrompt(baseInput, ctx);
    expect(assembled.taskType).toBe('run_eval');
    const ids = assembled.trace.map((t) => t.id);
    expect(ids).toContain('run_eval.header');
    expect(ids).toContain('run_eval.scenario');
    expect(ids).toContain('run_eval.final_output');
    // Dropped sections must not appear in the trace either — replay
    // tooling treats "absent from trace" as "never rendered".
    expect(ids).not.toContain('run_eval.correlation');
    expect(ids).not.toContain('run_eval.execution_mode');
  });
});
