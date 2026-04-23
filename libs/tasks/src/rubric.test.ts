import { describe, expect, it } from 'vitest';

import { type Rubric, validateRubricWeights } from './rubric.js';

const base: Rubric = {
  rubricId: 'test',
  version: 'v1',
  criteria: [],
};

describe('validateRubricWeights', () => {
  it('accepts weights summing to exactly 1', () => {
    const rubric: Rubric = {
      ...base,
      criteria: [
        { id: 'a', description: 'A', weight: 0.4, scoring: 'llm_judged' },
        { id: 'b', description: 'B', weight: 0.2, scoring: 'llm_judged' },
        { id: 'c', description: 'C', weight: 0.4, scoring: 'llm_judged' },
      ],
    };
    expect(validateRubricWeights(rubric)).toBeNull();
  });

  it('accepts weights within 1e-6 tolerance', () => {
    const rubric: Rubric = {
      ...base,
      criteria: [
        { id: 'a', description: 'A', weight: 0.1, scoring: 'llm_judged' },
        { id: 'b', description: 'B', weight: 0.2, scoring: 'llm_judged' },
        { id: 'c', description: 'C', weight: 0.3, scoring: 'llm_judged' },
        { id: 'd', description: 'D', weight: 0.4, scoring: 'llm_judged' },
      ],
    };
    expect(validateRubricWeights(rubric)).toBeNull();
  });

  it('rejects weights summing below 1', () => {
    const rubric: Rubric = {
      ...base,
      criteria: [
        { id: 'a', description: 'A', weight: 0.3, scoring: 'llm_judged' },
        { id: 'b', description: 'B', weight: 0.4, scoring: 'llm_judged' },
      ],
    };
    const err = validateRubricWeights(rubric);
    expect(err).not.toBeNull();
    expect(err).toMatch(/0\.7/);
  });

  it('rejects weights summing above 1', () => {
    const rubric: Rubric = {
      ...base,
      criteria: [
        { id: 'a', description: 'A', weight: 0.6, scoring: 'llm_judged' },
        { id: 'b', description: 'B', weight: 0.6, scoring: 'llm_judged' },
      ],
    };
    expect(validateRubricWeights(rubric)).toMatch(/1\.2/);
  });
});
