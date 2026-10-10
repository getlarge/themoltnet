import { getSubmitOutputContract } from '@themoltnet/agent-runtime';
import { describe, expect, it } from 'vitest';

import {
  formatValidationErrors,
  normalizeSubmitArguments,
  submitOutputGuidance,
} from './submit-output-tool.js';

const contract = getSubmitOutputContract('fulfill_brief');
if (!contract) throw new Error('fulfill_brief contract is missing');

const normalize = (params: unknown) =>
  normalizeSubmitArguments(
    'fulfill_brief',
    params,
    contract.parametersSchema,
    contract.toolName,
    contract.description,
    {},
  );

describe('Durable submit argument normalization', () => {
  const output = {
    branch: 'feat/x',
    commits: [],
    pullRequestUrl: null,
    diaryEntryIds: [],
    summary: 'done',
  };

  it('accepts a valid structured payload', () => {
    expect(normalize(output).candidate).toEqual(output);
  });

  it('unwraps an output envelope and records the repair', () => {
    const result = normalize({ output });
    expect(result.candidate).toEqual(output);
    expect(result.repairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'output_envelope' }),
      ]),
    );
  });

  it('rejects invalid arguments against the Pi schema', () => {
    expect(() => normalize({ branch: 7, commits: 'invalid' })).toThrow();
  });

  it('exposes validation feedback and the submit schema in prompts', () => {
    expect(
      formatValidationErrors([{ field: 'output/branch', message: 'required' }]),
    ).toBe('output/branch: required');
    expect(
      submitOutputGuidance('fulfill_brief', contract).promptSnippet,
    ).toContain(contract.parametersSchemaJson);
  });
});
