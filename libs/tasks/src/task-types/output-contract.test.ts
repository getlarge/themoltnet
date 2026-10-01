import { describe, expect, it } from 'vitest';

import {
  getTaskSubmissionSchema,
  normalizeTaskInputForCreate,
  validateTaskInput,
  validateTaskOutput,
  validateTaskSubmission,
} from '../validation.js';

const schema = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['technical', 'legal', 'other'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['category', 'confidence'],
  additionalProperties: false,
};
const input = {
  brief: 'Classify the supplied document.',
  outputContract: { version: 1, schema },
};
const output = {
  summary: 'Classified the document.',
  result: { category: 'technical', confidence: 0.92 },
  verification: {
    inputCid: 'bafy-input',
    results: [{ id: 'submit-output', kind: 'gate', status: 'pass' }],
    passed: true,
  },
};

describe('freeform outputContract', () => {
  it('advertises the task schema and validates it in submission and completion', () => {
    const normalized = normalizeTaskInputForCreate('freeform', input);
    const parameters = getTaskSubmissionSchema('freeform', normalized);

    expect(validateTaskInput('freeform', normalized)).toEqual([]);
    expect(parameters).toHaveProperty('properties.result', schema);
    expect(parameters).toHaveProperty(
      'required',
      expect.arrayContaining(['result']),
    );
    expect(parameters).not.toHaveProperty('properties.proposedTaskType');
    expect(
      validateTaskSubmission('freeform', output, normalized, {
        inputCid: 'bafy-input',
      }),
    ).toEqual([]);
    expect(
      validateTaskOutput('freeform', output, normalized, {
        inputCid: 'bafy-input',
      }),
    ).toEqual([]);
  });

  it('rejects missing, mistyped, and out-of-range results in every completion path', () => {
    for (const result of [
      undefined,
      { category: 'finance', confidence: 0.92 },
      { category: 'technical', confidence: 1.2 },
      { category: 'technical', confidence: 'high' },
    ]) {
      const candidate = { ...output, result };
      expect(validateTaskSubmission('freeform', candidate, input)).not.toEqual(
        [],
      );
      expect(validateTaskOutput('freeform', candidate, input)).not.toEqual([]);
    }
  });

  it('rejects unsupported schema keywords and uncontracted results', () => {
    expect(
      validateTaskInput('freeform', {
        ...input,
        outputContract: {
          version: 1,
          schema: { ...schema, patternProperties: {} },
        },
      }),
    ).not.toEqual([]);
    expect(
      validateTaskSubmission(
        'freeform',
        {
          summary: 'done',
          result: { category: 'technical' },
        },
        { brief: 'No contract.' },
      ),
    ).not.toEqual([]);
  });
});
