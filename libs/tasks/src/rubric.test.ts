import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  AssertionResult,
  type Rubric,
  RubricScoringMode,
  validateRubricWeights,
} from './rubric.js';
import { JudgePackScore } from './task-types/judge-pack.js';

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
        { id: 'a', description: 'A', weight: 0.4, scoring: 'llm_score' },
        { id: 'b', description: 'B', weight: 0.2, scoring: 'llm_score' },
        { id: 'c', description: 'C', weight: 0.4, scoring: 'llm_score' },
      ],
    };
    expect(validateRubricWeights(rubric)).toBeNull();
  });

  it('accepts weights within 1e-6 tolerance', () => {
    const rubric: Rubric = {
      ...base,
      criteria: [
        { id: 'a', description: 'A', weight: 0.1, scoring: 'llm_score' },
        { id: 'b', description: 'B', weight: 0.2, scoring: 'llm_score' },
        { id: 'c', description: 'C', weight: 0.3, scoring: 'llm_score' },
        { id: 'd', description: 'D', weight: 0.4, scoring: 'llm_score' },
      ],
    };
    expect(validateRubricWeights(rubric)).toBeNull();
  });

  it('rejects weights summing below 1', () => {
    const rubric: Rubric = {
      ...base,
      criteria: [
        { id: 'a', description: 'A', weight: 0.3, scoring: 'llm_score' },
        { id: 'b', description: 'B', weight: 0.4, scoring: 'llm_score' },
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
        { id: 'a', description: 'A', weight: 0.6, scoring: 'llm_score' },
        { id: 'b', description: 'B', weight: 0.6, scoring: 'llm_score' },
      ],
    };
    expect(validateRubricWeights(rubric)).toMatch(/1\.2/);
  });

  it('accepts llm_checklist as a scoring mode (#999)', () => {
    // Mixing llm_checklist with deterministic checks is the common case
    // for fidelity rubrics — grounding becomes per-claim binary while
    // coverage stays a deterministic threshold.
    const rubric: Rubric = {
      ...base,
      criteria: [
        {
          id: 'coverage',
          description: 'C',
          weight: 0.4,
          scoring: 'deterministic_coverage_check',
        },
        {
          id: 'grounding',
          description: 'G',
          weight: 0.6,
          scoring: 'llm_checklist',
        },
      ],
    };
    expect(validateRubricWeights(rubric)).toBeNull();
    expect(Value.Check(RubricScoringMode, 'llm_checklist')).toBe(true);
  });
});

describe('AssertionResult', () => {
  it('requires evidence on PASS — agentskills.io grading principle', () => {
    // The whole point of binary-with-evidence is that PASS without a
    // pointer at the supporting span is unauditable. Make sure the
    // schema enforces it rather than relying on prose to remind judges.
    const ok = {
      id: 'claim-1',
      text: 'The pack mentions hedge X verbatim',
      passed: true,
      evidence: 'source entry abc, line 4: "X applies on most slides"',
    };
    const missingEvidence = {
      id: 'claim-1',
      text: 'The pack mentions hedge X verbatim',
      passed: true,
    };
    expect(Value.Check(AssertionResult, ok)).toBe(true);
    expect(Value.Check(AssertionResult, missingEvidence)).toBe(false);
  });

  it('requires evidence on FAIL — for cluster analysis of failure modes', () => {
    const ok = {
      id: 'claim-2',
      text: 'Within ~10% of live transcripts',
      passed: false,
      evidence:
        'source says "within ~10% on most slides"; rendered drops "on most slides"',
    };
    const emptyEvidence = { ...ok, evidence: '' };
    expect(Value.Check(AssertionResult, ok)).toBe(true);
    // minLength: 1 must reject empty strings — silent FAILs poison the
    // dataset just as much as silent PASSes.
    expect(Value.Check(AssertionResult, emptyEvidence)).toBe(false);
  });
});

describe('JudgePackScore with llm_checklist (#999)', () => {
  it('accepts a score with the new assertions array', () => {
    const score = {
      criterionId: 'grounding',
      score: 0,
      assertions: [
        {
          id: 'claim-1',
          text: 'pack mentions hedge X',
          passed: true,
          evidence: 'source entry abc',
        },
        {
          id: 'claim-2',
          text: 'within ~10% (no hedge)',
          passed: false,
          evidence: 'source had "on most slides"; rendered dropped it',
        },
      ],
    };
    expect(Value.Check(JudgePackScore, score)).toBe(true);
  });

  it('keeps assertions optional so existing llm_score scores still validate', () => {
    // Backward compatibility: rubrics that haven't migrated to
    // llm_checklist must still produce schema-valid scores. The
    // assertions field is opt-in.
    const score = {
      criterionId: 'old-style',
      score: 0.85,
      rationale: 'mostly fine',
    };
    expect(Value.Check(JudgePackScore, score)).toBe(true);
  });

  it('rejects an assertions array with an empty entry', () => {
    // minItems: 1 protects against the judge emitting `assertions: []`
    // when it should have either omitted the field (non-llm_checklist
    // criterion) or enumerated real claims.
    const score = {
      criterionId: 'grounding',
      score: 1,
      assertions: [],
    };
    expect(Value.Check(JudgePackScore, score)).toBe(false);
  });
});
