import { describe, expect, it } from 'vitest';

import { redactRequiredEnvValues } from './secret-redaction.js';

describe('redactRequiredEnvValues', () => {
  it('redacts required profile secrets recursively from terminal output', () => {
    const secret = 'provider-secret-123';
    const output = {
      output: {
        summary: `found ${secret}`,
        nested: [`prefix-${secret}-suffix`],
      },
      error: { message: secret },
    };

    expect(
      redactRequiredEnvValues(output, ['OLLAMA_API_KEY'], {
        OLLAMA_API_KEY: secret,
      }),
    ).toEqual({
      output: {
        summary: 'found [REDACTED]',
        nested: ['prefix-[REDACTED]-suffix'],
      },
      error: { message: '[REDACTED]' },
    });
  });

  it('does not redact unrelated or suspiciously short values', () => {
    const output = { summary: 'token abc and safe text' };
    expect(
      redactRequiredEnvValues(output, ['SHORT', 'MISSING'], { SHORT: 'abc' }),
    ).toBe(output);
  });
});
