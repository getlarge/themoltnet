import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import {
  ClassifyInput,
  ClassifyOutput,
  validateClassifyOutput,
} from './classify.js';

const input: ClassifyInput = {
  version: 1,
  state: { title: 'Login fails' },
  questions: {
    kind: {
      type: 'choice',
      instructions: 'Classify the issue',
      criteria: { bug: 'Incorrect behavior', feature: 'New capability' },
    },
    severity: {
      type: 'score',
      instructions: 'Estimate severity',
      criteria: ['Minor', 'Major', 'Critical'],
    },
    actionable: {
      type: 'bool',
      instructions: 'Is there enough information?',
      criteria: { true: 'Reproducible', false: 'Needs clarification' },
    },
  },
};
const output: ClassifyOutput = {
  version: 1,
  provider: 'typesafe',
  model: 'jev-latest',
  answers: {
    kind: {
      type: 'choice',
      choice: 'bug',
      probabilities: { bug: 0.9, feature: 0.1 },
      confidence: 0.9,
    },
    severity: { type: 'score', score: 1.5, confidence: 0.7 },
    actionable: { type: 'bool', probability: 0.8 },
  },
};

describe('classification contract', () => {
  it('preserves distributions, fractional expected levels and missing usage', () => {
    expect(Value.Check(ClassifyInput, input)).toBe(true);
    expect(Value.Check(ClassifyOutput, output)).toBe(true);
    expect(validateClassifyOutput(output, input)).toBeNull();
    expect(output).not.toHaveProperty('usage');
  });
  it('rejects unknown answers and incomplete distributions', () => {
    expect(
      validateClassifyOutput(
        {
          ...output,
          answers: {
            ...output.answers,
            extra: { type: 'bool', probability: 1 },
          },
        },
        input,
      ),
    ).not.toBeNull();
    expect(
      validateClassifyOutput(
        {
          ...output,
          answers: {
            ...output.answers,
            kind: {
              type: 'choice',
              choice: 'bug',
              probabilities: { bug: 1 },
              confidence: 1,
            },
          },
        },
        input,
      ),
    ).not.toBeNull();
  });
  it('rejects invalid probability mass and scores outside the question scale', () => {
    expect(
      validateClassifyOutput(
        {
          ...output,
          answers: {
            ...output.answers,
            kind: {
              type: 'choice',
              choice: 'bug',
              probabilities: { bug: 0.7, feature: 0.7 },
              confidence: 1,
            },
          },
        },
        input,
      ),
    ).not.toBeNull();
    expect(
      validateClassifyOutput(
        {
          ...output,
          answers: {
            ...output.answers,
            severity: { type: 'score', score: 3, confidence: 1 },
          },
        },
        input,
      ),
    ).not.toBeNull();
    expect(
      Value.Check(ClassifyOutput, {
        ...output,
        answers: { actionable: { type: 'bool', probability: 2 } },
      }),
    ).toBe(false);
  });
});
