import type { ChallengeValidationInput } from './ceremony-service.js';

export function createChallengeValidator(fetchImpl: typeof fetch = fetch) {
  return async (input: ChallengeValidationInput): Promise<{ valid: true }> => {
    const apiUrl = trustedApiUrl(input.apiUrl);
    const response = await fetchImpl(
      new URL('/crypto/preview-sign/challenges/validate', apiUrl),
      {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: 1,
          operation: input.operation,
          resourceId: input.resourceId,
          challenge: input.challenge,
        }),
      },
    );
    if (!response.ok) {
      throw new Error('Server rejected the signing challenge');
    }
    const result: unknown = await response.json();
    if (
      typeof result !== 'object' ||
      result === null ||
      Array.isArray(result) ||
      Object.keys(result).length !== 1 ||
      !Object.hasOwn(result, 'valid') ||
      (result as { valid?: unknown }).valid !== true
    ) {
      throw new Error('Server returned an invalid challenge response');
    }
    return { valid: true };
  };
}

function trustedApiUrl(value: string): URL {
  const url = new URL(value);
  const loopback =
    url.hostname === '127.0.0.1' ||
    url.hostname === 'localhost' ||
    url.hostname === '[::1]';
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new Error('Signer API URL must be trusted HTTPS or loopback HTTP');
  }
  return url;
}
