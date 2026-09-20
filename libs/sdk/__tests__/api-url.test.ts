import { describe, expect, it } from 'vitest';

import {
  assertTrustedConfigApiUrl,
  DEFAULT_API_URL,
  normalizeApiUrl,
  normalizeOptionalApiUrl,
} from '../src/api-url.js';

describe('identity-owned API endpoints', () => {
  it('accepts a secure self-hosted identity endpoint', () => {
    expect(() =>
      assertTrustedConfigApiUrl('https://agents.example.org/api'),
    ).not.toThrow();
  });
  it('rejects non-loopback plaintext even for a hosted-looking name', () => {
    expect(() =>
      assertTrustedConfigApiUrl('http://agents.example.org'),
    ).toThrow(/HTTPS/);
  });
});

it('rejects a project endpoint that differs from the selected identity', () => {
  expect(() =>
    assertTrustedConfigApiUrl(
      'https://other.example',
      'https://identity.example',
    ),
  ).toThrow(/differs from the identity endpoint/);
  expect(() =>
    assertTrustedConfigApiUrl(
      'https://identity.example',
      'https://identity.example/',
    ),
  ).not.toThrow();
});

describe('API URL normalization', () => {
  it('uses truthy precedence for ordered connection candidates', () => {
    expect(normalizeApiUrl('', 'https://configured.example/')).toBe(
      'https://configured.example',
    );
    expect(normalizeApiUrl(undefined, null, '')).toBe(DEFAULT_API_URL);
  });

  it('preserves an explicitly empty optional API URL', () => {
    expect(normalizeOptionalApiUrl('')).toBe('');
    expect(normalizeOptionalApiUrl()).toBe(DEFAULT_API_URL);
  });
});
