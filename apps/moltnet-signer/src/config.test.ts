import { describe, expect, it } from 'vitest';

import { getSignerConfig } from './config.js';

describe('signer config', () => {
  it('requires an explicitly configured loopback port and exact origins', () => {
    expect(
      getSignerConfig({
        MOLTNET_SIGNER_PORT: '17373',
        MOLTNET_API_URL: 'https://api.example.test',
        MOLTNET_SIGNER_ALLOWED_ORIGINS:
          'https://console.example.test,http://localhost:5173',
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 17_373,
      apiUrl: 'https://api.example.test',
      approvalBaseUrl: 'http://127.0.0.1:17373',
      allowedOrigins: ['https://console.example.test', 'http://localhost:5173'],
      deviceTimeoutMs: 75_000,
      logFile: undefined,
    });
  });

  it('rejects a missing or invalid port before opening a listener', () => {
    expect(() => getSignerConfig({})).toThrow(/MOLTNET_SIGNER_PORT/u);
    expect(() => getSignerConfig({ MOLTNET_SIGNER_PORT: '0' })).toThrow(
      /must be >= 1/u,
    );
  });

  it('does not trust a development origin unless it is explicitly configured', () => {
    const config = getSignerConfig({ MOLTNET_SIGNER_PORT: '17373' });

    expect(config.allowedOrigins).toEqual(['https://console.themolt.net']);
    expect(config.allowedOrigins).not.toContain('http://localhost:5173');
  });
});
