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

  it('describes the requested execution mode and workspace', () => {
    const out = render(baseInput);
    expect(out).toContain('## Execution mode');
    expect(out).toContain('Mode: `vitro`');
    expect(out).toContain('Workspace: `none`');
    expect(out).toContain('no repository checkout mounted');
  });

  it('omits injected-context discipline when no task context exists', () => {
    expect(render(baseInput)).not.toContain('## Injected context discipline');
  });

  it('requires inspecting context before solving when task context exists', () => {
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
    expect(out).toContain('## Injected context discipline');
    expect(out).toContain(
      'MUST inspect and use that context BEFORE you write solution',
    );
    expect(out).toContain(
      'Do not solve first and only review the context afterward.',
    );
    expect(out).toContain(
      'your FIRST content-inspection step should be a `read` of `/workspace/context-pack.md` before your first `write` call',
    );
    expect(out).toContain('skip reading it before writing solution files');
    expect(out).toContain('/workspace/context-pack.md');
    expect(out).toContain('/workspace/AGENTS.md');
  });

  it('omits the correlation section when correlationId is null/absent', () => {
    expect(render(baseInput)).not.toContain('## Correlation');
    expect(render(baseInput, { ...ctx, correlationId: null })).not.toContain(
      '## Correlation',
    );
  });

  it('emits the correlation section when correlationId is set', () => {
    const out = render(baseInput, { ...ctx, correlationId: 'corr-abc' });
    expect(out).toContain('## Correlation');
    expect(out).toContain('corr-abc');
  });

  it('exposes a structured per-section trace alongside the text', () => {
    const assembled = buildRunEvalUserPrompt(baseInput, ctx);
    expect(assembled.taskType).toBe('run_eval');
    const ids = assembled.trace.map((t) => t.id);
    expect(ids).toContain('run_eval.header');
    expect(ids).toContain('run_eval.scenario');
    expect(ids).toContain('run_eval.final_output');
    // Absent optional sections are kept in the trace with char_count 0.
    const correlation = assembled.trace.find(
      (t) => t.id === 'run_eval.correlation',
    );
    expect(correlation?.char_count).toBe(0);
  });
});
