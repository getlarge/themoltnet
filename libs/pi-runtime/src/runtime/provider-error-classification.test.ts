import { describe, expect, it } from 'vitest';

import {
  appendPermanentProviderRequestDiagnostics,
  extractPermanentProviderRequestFields,
  getPermanentProviderRequestDiagnostics,
  isPermanentProviderQuotaError,
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
  it('extracts supported field forms with bounded parsing of provider text', () => {
    expect(
      extractPermanentProviderRequestFields(
        'Unsupported parameter: reasoning_effort\nunknown request field "response_format"\nparameter verbosity is not supported',
      ),
    ).toEqual(['reasoning_effort', 'response_format', 'verbosity']);
    expect(
      extractPermanentProviderRequestFields(
        `unsupported parameter${' '.repeat(10_000)}`,
      ),
    ).toEqual([]);
  });

  it('distinguishes exhausted monthly capacity from ordinary rate limiting', () => {
    expect(
      isPermanentProviderQuotaError(
        '429: you (account) have reached your monthly usage limit, upgrade for higher limits or add usage credits',
      ),
    ).toBe(true);
    expect(isPermanentProviderQuotaError('Monthly usage limit reached')).toBe(
      true,
    );
    expect(isPermanentProviderQuotaError('429: rate limit exceeded')).toBe(
      false,
    );
    expect(isPermanentProviderQuotaError('429: too many requests')).toBe(false);
  });

  it('constructs structured actionable diagnostics for a terminal provider error', () => {
    const diagnostics = getPermanentProviderRequestDiagnostics(
      {
        code: 'llm_request_rejected',
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

    expect(isPermanentProviderRequestError(error.message, true)).toBe(false);
    expect(
      getPermanentProviderRequestDiagnostics(error, CONTEXT),
    ).toBeUndefined();
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
          code: 'llm_request_rejected',
          message: 'Unsupported parameter: reasoning_effort',
          retryable: true,
        },
        CONTEXT,
      ),
    ).toBeUndefined();
  });
});
