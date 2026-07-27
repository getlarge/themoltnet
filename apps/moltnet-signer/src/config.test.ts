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
    });
  });

  it('rejects a missing or invalid port before opening a listener', () => {
    expect(() => getSignerConfig({})).toThrow(/MOLTNET_SIGNER_PORT/u);
    expect(() => getSignerConfig({ MOLTNET_SIGNER_PORT: '0' })).toThrow(
      /valid TCP port/u,
    );
  });
});
