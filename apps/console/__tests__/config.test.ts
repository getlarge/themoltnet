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
    // docsUrl is optional in injected config — defaults when absent so existing
    // /config.js (which predates docsUrl) stays valid.
    expect(config.docsUrl).toBe('https://docs.themolt.net');
    expect(config.signerUrl).toBe('http://127.0.0.1:17373');
  });

  it('uses injected docsUrl when provided', () => {
    (window as Window).__MOLTNET_CONFIG__ = {
      kratosUrl: 'https://kratos.example.com',
      apiBaseUrl: 'https://api.example.com',
      consoleUrl: 'https://console.example.com',
      docsUrl: 'https://docs.example.com',
    };

    expect(getConfig().docsUrl).toBe('https://docs.example.com');
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

  it('throws in production when runtime config is missing', () => {
    vi.stubEnv('MODE', 'production');

    expect(() => getConfig()).toThrow(
      'Missing runtime config: window.__MOLTNET_CONFIG__ must include kratosUrl, apiBaseUrl, and consoleUrl. Ensure /config.js is served correctly in production.',
    );
  });

  it('uses default URLs when neither injected config nor env vars', () => {
    const config = getConfig();

    expect(config.kratosUrl).toBe('http://localhost:4433');
    expect(config.apiBaseUrl).toBe('http://localhost:8000');
    expect(config.consoleUrl).toBe('http://localhost:5174');
    expect(config.docsUrl).toBe('https://docs.themolt.net');
    expect(config.signerUrl).toBe('http://127.0.0.1:17373');
  });
});

describe('getConfig packGcTtlDays', () => {
  afterEach(() => {
    delete (window as Window).__MOLTNET_CONFIG__;
    vi.unstubAllEnvs();
  });

  const withInjected = (packGcTtlDays: string) => {
    (window as Window).__MOLTNET_CONFIG__ = {
      kratosUrl: 'https://kratos.example.com',
      apiBaseUrl: 'https://api.example.com',
      consoleUrl: 'https://console.example.com',
      packGcTtlDays,
    };
    return getConfig().packGcTtlDays;
  };

  it('parses the injected integer window', () => {
    expect(withInjected('30')).toBe(30);
  });

  // PACK_GC_COMPILE_TTL_DAYS is Type.Number() on the server, so a sub-day
  // window is valid. Flooring 0.5 to 0 would make unpin send an expiresAt of
  // "now", which PATCH rejects for not being in the future.
  it('preserves a fractional window rather than flooring it', () => {
    expect(withInjected('0.5')).toBe(0.5);
    expect(withInjected('1.5')).toBe(1.5);
  });

  it('tolerates surrounding whitespace from envsubst', () => {
    expect(withInjected(' 14 ')).toBe(14);
  });

  it.each(['', 'abc', '0', '-3', 'Infinity'])(
    'falls back to the server default for the unusable value %p',
    (value) => {
      expect(withInjected(value)).toBe(7);
    },
  );

  it('falls back when the key is absent from injected config', () => {
    (window as Window).__MOLTNET_CONFIG__ = {
      kratosUrl: 'https://kratos.example.com',
      apiBaseUrl: 'https://api.example.com',
      consoleUrl: 'https://console.example.com',
    };
    expect(getConfig().packGcTtlDays).toBe(7);
  });

  it('reads the Vite env var in development', () => {
    vi.stubEnv('VITE_PACK_GC_TTL_DAYS', '21');
    expect(getConfig().packGcTtlDays).toBe(21);
  });

  it('defaults to the server default in development', () => {
    expect(getConfig().packGcTtlDays).toBe(7);
  });
});
