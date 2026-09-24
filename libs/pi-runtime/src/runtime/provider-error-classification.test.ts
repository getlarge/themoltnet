import { isRetryableAssistantError } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';

import {
  appendProviderFailureDiagnostics,
  classifyProviderFailure,
  extractPermanentProviderRequestFields,
  getProviderFailureDiagnostics,
  isPermanentProviderQuotaError,
  isPermanentProviderRequestError,
} from './provider-error-classification.js';

const CONTEXT = {
  provider: 'openai',
  model: 'gpt-5',
  runtimeProfileId: 'profile-1',
  runtimeProfileName: 'default-coding',
  runtimeProfileRevision: 7,
  piAgentDirSource: 'store' as const,
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
    ['status: 503 unknown field request_id', 'llm_api_error'],
    ['provider returned 429: invalid field temperature', 'llm_api_error'],
    ['response: 408 unsupported parameter top_p', 'llm_api_error'],
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
    ['{"error":{"code":401,"status":"UNAUTHENTICATED"}}', 'llm_auth_error'],
    [
      '400 Request validation failed: unsupported shape',
      'llm_request_rejected',
    ],
    ['Request was cancelled.', 'llm_request_cancelled'],
    [
      'OpenAI API error (401): {"error":{"code":"invalid_api_key"}}',
      'llm_auth_error',
    ],
    ['Azure OpenAI API error (401): Unauthorized', 'llm_auth_error'],
    ['Mistral API error (403): Forbidden', 'llm_auth_error'],
    ['Request failed with status code 401: Unauthorized', 'llm_auth_error'],
    ['OpenAI API error (503): {"error":{"code":401}}', 'llm_api_error'],
    ['[{"error":{"code":401,"status":"UNAUTHENTICATED"}}]', 'llm_auth_error'],
    ['Provider API error (401): {"error":{"code":401}}', 'llm_auth_error'],
    ['Provider returned error: {"error":{"code":401}}', 'llm_auth_error'],
    ['Provider returned error 403: Forbidden', 'llm_auth_error'],
    [
      'OpenAI API error (400): Request validation failed',
      'llm_request_rejected',
    ],
    ['OpenAI API error (400): Request was cancelled', 'llm_request_cancelled'],
    [
      'OpenAI API error (400): Unsupported parameter: top_p',
      'llm_request_rejected',
    ],
    ['OpenAI API error (400): {"error":{"code":503}}', 'llm_api_error'],
    ['Error: {"error":{"code":403}}', 'llm_auth_error'],
    ['401 Invalid API key, see billing for more information', 'llm_auth_error'],
    ['502 Bad Gateway: upstream responded 401', 'llm_api_error'],
    [
      'OpenAI API error (503): The model gpt-4o is currently not available, please retry',
      'llm_api_error',
    ],
    [
      'OpenAI API error (429): Request was cancelled because of rate limiting',
      'llm_api_error',
    ],
    ['503 upstream request cancelled', 'llm_api_error'],
    ['402 Insufficient credits for this request', 'llm_quota_exhausted'],
    ['404 The model `gpt-9` does not exist', 'invalid_model'],
    [
      'Error 403: Your credit balance is too low. Billing required',
      'llm_quota_exhausted',
    ],
    ["Model 'x' not found in registry", 'invalid_model'],
    ['500 response: unknown field request_id', 'llm_api_error'],
    ['request timed out: unsupported field response_format', 'llm_api_error'],
    ['stream canceled by peer', 'llm_api_error'],
    ['upstream says request validation failed', 'llm_api_error'],
    ['Invalid API key, see https://example.test/billing', 'llm_auth_error'],
    ['400 billing_hard_limit_reached', 'llm_quota_exhausted'],
  ])('classifies provider text %s as %s', (message, code) => {
    expect(classifyProviderFailure(message)).toMatchObject({
      code,
      retryable: code === 'llm_api_error',
    });
  });

  it.each([
    ['status: 503 unknown field request_id', 'transient_status'],
    [
      'request timed out: unsupported field response_format',
      'transient_transport',
    ],
    ['400 Unsupported parameter: timeout', 'request_rejected'],
    ['{"error":{"code":401}}', 'auth_error'],
    ['Request was cancelled.', 'cancelled'],
    ['a provider error without known evidence', 'unknown'],
  ])('records classification reason for %s', (message, reason) => {
    expect(classifyProviderFailure(message).reason).toBe(reason);
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
      'GoUsageLimitError',
      'FreeUsageLimitError',
      'Monthly usage limit reached',
      'available balance',
      'insufficient_quota',
      'out of budget',
      'billing_hard_limit_reached',
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
    const diagnostics = getProviderFailureDiagnostics(
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
    const error = appendProviderFailureDiagnostics(
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

  it.each([
    ['llm_auth_error', '401 Invalid API key'],
    ['llm_quota_exhausted', 'Monthly usage limit reached'],
    ['llm_request_cancelled', 'Request was cancelled'],
  ])('adds provider and profile context to %s', (code, message) => {
    const error = appendProviderFailureDiagnostics(
      { code, message, retryable: false },
      CONTEXT,
    );
    expect(error.message).toContain('Provider/model: openai/gpt-5.');
    expect(error.message).toContain('Runtime profile: default-coding');
    expect(error.message).not.toContain('Unsupported request field(s):');
  });

  it('gives transient evidence precedence over request-shape wording', () => {
    const error = {
      code: 'llm_api_error',
      message: '500 response: unknown field request_id',
      retryable: false,
    };

    expect(isPermanentProviderRequestError(error.message)).toBe(true);
    expect(getProviderFailureDiagnostics(error.message, CONTEXT)).toBeDefined();
    expect(appendProviderFailureDiagnostics(error, CONTEXT)).toEqual(error);
  });

  it('does not attach provider diagnostics to other or already retryable errors', () => {
    expect(
      appendProviderFailureDiagnostics(
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
      appendProviderFailureDiagnostics(
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
    const error = appendProviderFailureDiagnostics(
      { code: 'llm_request_rejected', message: fields, retryable: false },
      CONTEXT,
    );
    expect(error.message.length).toBeLessThanOrEqual(4000);
  });
});
