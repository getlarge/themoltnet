import { afterEach, describe, expect, it, vi } from 'vitest';

import { getConfig } from '../src/config.js';

describe('getConfig', () => {
  afterEach(() => {
    delete (window as Window).__MOLTNET_CONFIG__;
    vi.unstubAllEnvs();
  });

  it('returns injected config from window.__MOLTNET_CONFIG__', () => {
    (window as Window).__MOLTNET_CONFIG__ = {
      kratosUrl: 'https://kratos.example.com',
      apiBaseUrl: 'https://api.example.com',
      consoleUrl: 'https://console.example.com',
    };

    const config = getConfig();

    expect(config.kratosUrl).toBe('https://kratos.example.com');
    expect(config.apiBaseUrl).toBe('https://api.example.com');
    expect(config.consoleUrl).toBe('https://console.example.com');
  });

  it('falls back to import.meta.env when no injected config', () => {
    vi.stubEnv('VITE_KRATOS_URL', 'http://kratos-env:4433');
    vi.stubEnv('VITE_API_BASE_URL', 'http://api-env:8000');
    vi.stubEnv('VITE_CONSOLE_URL', 'http://console-env:5174');

    const config = getConfig();

    expect(config.kratosUrl).toBe('http://kratos-env:4433');
    expect(config.apiBaseUrl).toBe('http://api-env:8000');
    expect(config.consoleUrl).toBe('http://console-env:5174');
  });

  it('uses default URLs when neither injected config nor env vars', () => {
    const config = getConfig();

    expect(config.kratosUrl).toBe('http://localhost:4433');
    expect(config.apiBaseUrl).toBe('http://localhost:8000');
    expect(config.consoleUrl).toBe('http://localhost:5174');
  });
});
