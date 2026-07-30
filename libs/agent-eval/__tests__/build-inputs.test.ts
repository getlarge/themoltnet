import {
  JudgeEvalAttemptInput,
  RunEvalInput,
  validateJudgeEvalAttemptInput,
} from '@moltnet/tasks';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import { buildJudgeInput, buildRunEvalInput } from '../src/build-inputs.js';
import type { Scenario } from '../src/scenario.js';

const scenario: Scenario = {
  slug: 'submit-output-compliance',
  prompt: 'Call the submit tool exactly once with a short summary.',
  execution: { mode: 'vitro', workspace: 'none' },
  rubric: {
    rubricId: 'submit-output-compliance',
    version: 'v1',
    criteria: [
      {
        id: 'summary-present',
        description: 'Response contains a non-empty summary.',
        weight: 1,
        scoring: 'llm_score',
      },
    ],
  },
  gates: { requireCleanSubmit: true },
};

describe('buildRunEvalInput', () => {
  it('produces a schema-valid RunEvalInput with empty (baseline) context', () => {
    // Act
    const input = buildRunEvalInput(scenario, { variant: 'baseline' });

    // Assert
    expect(Value.Check(RunEvalInput, input)).toBe(true);
    expect(input.context).toEqual([]);
    expect(input.scenario.prompt).toBe(scenario.prompt);
    expect(input.execution).toEqual({ mode: 'vitro', workspace: 'none' });
  });

  it('never leaks the rubric to the producer input', () => {
    // Act
    const input = buildRunEvalInput(scenario, { variant: 'baseline' });

    // Assert — no successCriteria (hence no rubric) on the producer side.
    expect('successCriteria' in input).toBe(false);
    expect(JSON.stringify(input)).not.toContain('summary-present');
  });

  it('carries supplied context for a non-baseline variant', () => {
    // Act
    const input = buildRunEvalInput(scenario, {
      variant: 'with-context',
      context: [
        { slug: 'pack', binding: 'context_inline', content: 'rendered pack' },
      ],
    });

    // Assert
    expect(Value.Check(RunEvalInput, input)).toBe(true);
    expect(input.context).toHaveLength(1);
  });

  it('keeps variantLabel within the 64-char bound', () => {
    // Act
    const input = buildRunEvalInput(scenario, { variant: 'baseline' });

    // Assert
    expect(input.variantLabel.length).toBeLessThanOrEqual(64);
    expect(input.variantLabel).toContain(scenario.slug);
  });
});

describe('buildJudgeInput', () => {
  it('produces a schema-valid JudgeEvalAttemptInput carrying the hidden rubric', () => {
    // Act
    const input = buildJudgeInput(scenario, {
      targetTaskId: '00000000-0000-4000-8000-000000000001',
      targetAttemptN: 1,
    });

    // Assert
    expect(Value.Check(JudgeEvalAttemptInput, input)).toBe(true);
    expect(validateJudgeEvalAttemptInput(input)).toBeNull();
    expect(input.successCriteria.rubric?.rubricId).toBe(
      'submit-output-compliance',
    );
  });
});
