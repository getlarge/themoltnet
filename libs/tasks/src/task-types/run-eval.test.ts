import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  RUN_EVAL_TYPE,
  RunEvalInput,
  RunEvalOutput,
  validateRunEvalOutput,
} from './run-eval.js';

const minimalInput = {
  scenario: { prompt: 'Summarize the file.' },
  variantLabel: 'baseline',
  context: [],
  model: 'claude-opus-4-7',
};

const minimalOutput = {
  response: 'Here is the summary.',
  totalTokens: 1234,
  durationMs: 4321,
  traceparent: '00-aaaa-bbbb-01',
};

/**
 * Stub successCriteria. Schema-valid (`version: 1`) and includes the
 * minimal optional that satisfies the cross-field validator below; we
 * don't exercise rubric validation here — that's covered by
 * `success-criteria.test.ts`.
 */
const stubCriteria = { version: 1 as const };
const stubVerification = {
  inputCid: 'bafyinput',
  results: [],
  passed: true,
};

describe('RUN_EVAL_TYPE', () => {
  it('is the canonical name', () => {
    expect(RUN_EVAL_TYPE).toBe('run_eval');
  });
});

describe('RunEvalInput', () => {
  it('accepts a minimal baseline input (empty context)', () => {
    expect(Value.Check(RunEvalInput, minimalInput)).toBe(true);
  });

  it('accepts context entries', () => {
    expect(
      Value.Check(RunEvalInput, {
        ...minimalInput,
        context: [{ cid: 'bafy1', binding: 'skill' }],
      }),
    ).toBe(true);
  });

  it('rejects empty variantLabel', () => {
    expect(
      Value.Check(RunEvalInput, { ...minimalInput, variantLabel: '' }),
    ).toBe(false);
  });

  it('rejects unknown extra fields', () => {
    expect(
      Value.Check(RunEvalInput, { ...minimalInput, scenarioCid: 'x' }),
    ).toBe(false);
  });

  it('accepts optional successCriteria', () => {
    expect(
      Value.Check(RunEvalInput, {
        ...minimalInput,
        successCriteria: stubCriteria,
      }),
    ).toBe(true);
  });
});

describe('RunEvalOutput', () => {
  it('accepts a minimal output', () => {
    expect(Value.Check(RunEvalOutput, minimalOutput)).toBe(true);
  });

  it('accepts artifacts', () => {
    expect(
      Value.Check(RunEvalOutput, {
        ...minimalOutput,
        artifacts: [{ path: 'out.md', cid: 'bafy1' }],
      }),
    ).toBe(true);
  });
});

describe('validateRunEvalOutput (cross-field)', () => {
  it('requires verification when input.successCriteria present', () => {
    expect(
      validateRunEvalOutput(minimalOutput, {
        ...minimalInput,
        successCriteria: stubCriteria,
      }),
    ).toMatch(/verification is required/);
  });

  it('rejects verification when input.successCriteria absent', () => {
    expect(
      validateRunEvalOutput(
        { ...minimalOutput, verification: stubVerification },
        minimalInput,
      ),
    ).toMatch(/omit verification/);
  });

  it('passes when both are absent', () => {
    expect(validateRunEvalOutput(minimalOutput, minimalInput)).toBeNull();
  });

  it('passes when both are present', () => {
    expect(
      validateRunEvalOutput(
        { ...minimalOutput, verification: stubVerification },
        { ...minimalInput, successCriteria: stubCriteria },
      ),
    ).toBeNull();
  });
});
