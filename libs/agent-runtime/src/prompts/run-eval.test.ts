import { describe, expect, it } from 'vitest';

import { buildRunEvalUserPrompt } from './run-eval.js';

const baseInput = {
  scenario: { prompt: 'List the top 3 risks in this code.' },
  variantLabel: 'with-skill',
  context: [],
};

const ctx = { diaryId: 'd-1', taskId: 't-1' };

describe('buildRunEvalUserPrompt', () => {
  it('embeds the scenario prompt verbatim', () => {
    const out = buildRunEvalUserPrompt(baseInput, ctx);
    expect(out).toContain('List the top 3 risks in this code.');
  });

  it('includes the variantLabel for traceability', () => {
    const out = buildRunEvalUserPrompt(baseInput, ctx);
    expect(out).toContain('with-skill');
  });

  it('includes the task id (agent must echo it)', () => {
    expect(buildRunEvalUserPrompt(baseInput, ctx)).toContain('t-1');
  });

  it('omits the self-verification block when no successCriteria', () => {
    const out = buildRunEvalUserPrompt(baseInput, ctx);
    // The header `## Self-verification` is only emitted by the
    // self-verification block itself; the final-output block mentions
    // the word in its prose but never as a heading.
    expect(out).not.toContain('## Self-verification');
  });

  it('includes the self-verification block when successCriteria present', () => {
    const out = buildRunEvalUserPrompt(
      { ...baseInput, successCriteria: { version: 1 as const } },
      ctx,
    );
    expect(out).toContain('## Self-verification');
  });

  it('lists scenario inputFiles when present', () => {
    const out = buildRunEvalUserPrompt(
      { ...baseInput, scenario: { prompt: 'x', inputFiles: ['a.md'] } },
      ctx,
    );
    expect(out).toContain('a.md');
  });

  it('always emits the final-output block', () => {
    expect(buildRunEvalUserPrompt(baseInput, ctx)).toContain('RunEvalOutput');
  });

  it('omits the correlation section when correlationId is null/absent', () => {
    expect(buildRunEvalUserPrompt(baseInput, ctx)).not.toContain(
      '### Correlation',
    );
    expect(
      buildRunEvalUserPrompt(baseInput, { ...ctx, correlationId: null }),
    ).not.toContain('### Correlation');
  });

  it('emits the correlation section when correlationId is set', () => {
    const out = buildRunEvalUserPrompt(baseInput, {
      ...ctx,
      correlationId: 'corr-abc',
    });
    expect(out).toContain('### Correlation');
    expect(out).toContain('corr-abc');
  });
});
