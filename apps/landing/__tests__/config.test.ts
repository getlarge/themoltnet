import { afterEach, describe, expect, it, vi } from 'vitest';

import { getConfig } from '../src/config.js';

describe('getConfig', () => {
  afterEach(() => {
    delete (window as Window).__MOLTNET_CONFIG__;
    vi.unstubAllEnvs();
  });

  it('returns injected config from window.__MOLTNET_CONFIG__', () => {
    (window as Window).__MOLTNET_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com',
    };

    const config = getConfig();

    expect(config.apiBaseUrl).toBe('https://api.example.com');
  });

  it('falls back to import.meta.env when no injected config', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://api-env:8000');

    const config = getConfig();

    expect(config.apiBaseUrl).toBe('http://api-env:8000');
  });

  it('throws in production when runtime config is missing', () => {
    vi.stubEnv('MODE', 'production');

    expect(() => getConfig()).toThrow(
      'Missing runtime config: window.__MOLTNET_CONFIG__.apiBaseUrl was not injected. Ensure /config.js is served correctly in production.',
    );
  });

  it('uses the default API URL when neither injected config nor env vars exist', () => {
    const config = getConfig();

    expect(config.apiBaseUrl).toBe('http://localhost:8000');
  });
});
