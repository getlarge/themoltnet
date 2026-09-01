import { describe, expect, it } from 'vitest';

import {
  DEFAULT_API_URL,
  normalizeApiUrl,
  normalizeOptionalApiUrl,
} from '../src/api-url.js';

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
