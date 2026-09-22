import { describe, expect, it } from 'vitest';

import {
  appendPermanentProviderRequestDiagnostics,
  getPermanentProviderRequestDiagnostics,
  isPermanentProviderRequestError,
} from './provider-error-classification.js';

const CONTEXT = {
  provider: 'openai',
  model: 'gpt-5',
  runtimeProfileId: 'profile-1',
  runtimeProfileName: 'default-coding',
  runtimeProfileRevision: 7,
  piAgentDirSource: 'store',
};

describe('provider request error classification', () => {
  it('constructs structured actionable diagnostics for a terminal provider error', () => {
    const diagnostics = getPermanentProviderRequestDiagnostics(
      {
        code: 'llm_api_error',
        message: 'Unsupported parameter: reasoning_effort',
        retryable: false,
      },
      CONTEXT,
    );

    expect(diagnostics).toEqual({
      ...CONTEXT,
      unsupportedFields: ['reasoning_effort'],
      remediation:
        'remove or disable these fields in the active Pi model/profile ' +
        'configuration, or select a provider/model that supports them, then retry.',
    });
  });

  it('gives transient evidence precedence over request-shape wording', () => {
    const error = {
      code: 'llm_api_error',
      message: '500 response: unknown field request_id',
      retryable: false,
    };

    expect(isPermanentProviderRequestError(error.message)).toBe(false);
    expect(getPermanentProviderRequestDiagnostics(error, CONTEXT)).toBeUndefined();
    expect(appendPermanentProviderRequestDiagnostics(error, CONTEXT)).toEqual(
      error,
    );
  });

  it('does not attach provider diagnostics to other or already retryable errors', () => {
    expect(
      getPermanentProviderRequestDiagnostics(
        {
          code: 'complete_call_failed',
          message: 'Unsupported parameter: reasoning_effort',
          retryable: true,
        },
        CONTEXT,
      ),
    ).toBeUndefined();
    expect(
      getPermanentProviderRequestDiagnostics(
        {
          code: 'llm_api_error',
          message: 'Unsupported parameter: reasoning_effort',
          retryable: true,
        },
        CONTEXT,
      ),
    ).toBeUndefined();
  });
});
