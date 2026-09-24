import { isRetryableAssistantError } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';

import {
  appendPermanentProviderRequestDiagnostics,
  classifyProviderFailure,
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
    expect(
      isPermanentProviderQuotaError(
        'Quota exceeded per minute. Please retry in 12s',
      ),
    ).toBe(false);
  });

  it.each([
    ["400 Unsupported parameter: 'timeout'", 'llm_request_rejected'],
    ['400 Unsupported parameter: forbidden', 'llm_request_rejected'],
    ['Error 429: invalid parameter temperature', 'llm_api_error'],
    [
      '400 Unsupported parameter: request_id=req_8a5003f1',
      'llm_request_rejected',
    ],
    ['400 Unsupported parameter: request id 1f429abc', 'llm_request_rejected'],
    ['max_tokens: 512 is not supported', 'llm_request_rejected'],
    [
      'Provider returned error: Unsupported parameter: top_p',
      'llm_request_rejected',
    ],
    ['502 Bad Gateway: upstream responded 401', 'llm_api_error'],
    [
      '429 RESOURCE_EXHAUSTED: Quota exceeded per minute. Please retry in 12s',
      'llm_api_error',
    ],
    ['429: you have reached your monthly usage limit', 'llm_quota_exhausted'],
    ['HTTP 403 forbidden', 'llm_auth_error'],
    ["Model 'x' not found in registry", 'invalid_model'],
    ['500 response: unknown field request_id', 'llm_api_error'],
    ['request timed out: unsupported field response_format', 'llm_api_error'],
  ])('classifies provider text %s as %s', (message, code) => {
    expect(classifyProviderFailure(message).code).toBe(code);
  });

  it("pins Pi's broad retry wording to our request-shape guard", () => {
    const piMessage = {
      stopReason: 'error',
      errorMessage: 'Provider returned error: Unsupported parameter: timeout',
    } as Parameters<typeof isRetryableAssistantError>[0];
    expect(isRetryableAssistantError(piMessage)).toBe(true);
    expect(classifyProviderFailure(piMessage.errorMessage).retryable).toBe(
      false,
    );
  });

  it('pins Pi account-limit wording while allowing time-windowed quota', () => {
    for (const message of [
      'Monthly usage limit reached',
      'insufficient_quota',
      'out of budget',
    ]) {
      expect(
        isRetryableAssistantError({
          stopReason: 'error',
          errorMessage: message,
        } as Parameters<typeof isRetryableAssistantError>[0]),
      ).toBe(false);
      expect(classifyProviderFailure(message).code).toBe('llm_quota_exhausted');
    }
    expect(
      classifyProviderFailure(
        '429 RESOURCE_EXHAUSTED: Quota exceeded per minute. Please retry in 12s',
      ),
    ).toMatchObject({ code: 'llm_api_error', retryable: true });
  });

  it('constructs structured actionable diagnostics for a terminal provider error', () => {
    const diagnostics = getPermanentProviderRequestDiagnostics(
      'Unsupported parameter: reasoning_effort',
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

  it('provides model remediation for invalid_model', () => {
    const error = appendPermanentProviderRequestDiagnostics(
      {
        code: 'invalid_model',
        message: "Model 'x' not found in registry",
        retryable: false,
      },
      CONTEXT,
    );
    expect(error.message).toContain('Provider/model: openai/gpt-5.');
    expect(error.message).toContain(
      'select a model available from the configured provider',
    );
  });

  it('gives transient evidence precedence over request-shape wording', () => {
    const error = {
      code: 'llm_api_error',
      message: '500 response: unknown field request_id',
      retryable: false,
    };

    expect(isPermanentProviderRequestError(error.message)).toBe(true);
    expect(
      getPermanentProviderRequestDiagnostics(error.message, CONTEXT),
    ).toBeDefined();
    expect(appendPermanentProviderRequestDiagnostics(error, CONTEXT)).toEqual(
      error,
    );
  });

  it('does not attach provider diagnostics to other or already retryable errors', () => {
    expect(
      appendPermanentProviderRequestDiagnostics(
        {
          code: 'complete_call_failed',
          message: 'Unsupported parameter: reasoning_effort',
          retryable: true,
        },
        CONTEXT,
      ),
    ).toEqual({
      code: 'complete_call_failed',
      message: 'Unsupported parameter: reasoning_effort',
      retryable: true,
    });
    expect(
      appendPermanentProviderRequestDiagnostics(
        {
          code: 'llm_request_rejected',
          message: 'Unsupported parameter: reasoning_effort',
          retryable: true,
        },
        CONTEXT,
      ),
    ).toEqual({
      code: 'llm_request_rejected',
      message: 'Unsupported parameter: reasoning_effort',
      retryable: true,
    });
  });

  it('bounds extracted fields and the final message', () => {
    const fields = Array.from(
      { length: 30 },
      (_, index) => `Unsupported parameter: field_${index}_${'x'.repeat(100)}`,
    ).join('\n');
    expect(extractPermanentProviderRequestFields(fields)).toHaveLength(8);
    expect(
      extractPermanentProviderRequestFields(fields)[0]?.length,
    ).toBeLessThanOrEqual(64);
    const error = appendPermanentProviderRequestDiagnostics(
      { code: 'llm_request_rejected', message: fields, retryable: false },
      CONTEXT,
    );
    expect(error.message.length).toBeLessThanOrEqual(4000);
  });
});
