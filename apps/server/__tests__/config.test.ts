import { describe, expect, it } from 'vitest';

import { loadCombinedConfig } from '../src/config.js';

describe('loadCombinedConfig', () => {
  it('should include staticDir from STATIC_DIR env var', () => {
    const config = loadCombinedConfig({
      STATIC_DIR: '/some/path',
      ORY_ACTION_API_KEY: 'test-key',
      RECOVERY_CHALLENGE_SECRET: 'secret-at-least-16-chars',
      DBOS_SYSTEM_DATABASE_URL: 'postgresql://localhost/moltnet_dbos',
    });
    expect(config.staticDir).toBe('/some/path');
  });

  it('should set staticDir to undefined when STATIC_DIR is empty', () => {
    const config = loadCombinedConfig({
      STATIC_DIR: '',
      ORY_ACTION_API_KEY: 'test-key',
      RECOVERY_CHALLENGE_SECRET: 'secret-at-least-16-chars',
      DBOS_SYSTEM_DATABASE_URL: 'postgresql://localhost/moltnet_dbos',
    });
    expect(config.staticDir).toBeUndefined();
  });

  it('should delegate to REST API config loaders', () => {
    const config = loadCombinedConfig({
      PORT: '9000',
      NODE_ENV: 'production',
      ORY_ACTION_API_KEY: 'test-key',
      RECOVERY_CHALLENGE_SECRET: 'secret-at-least-16-chars',
      DBOS_SYSTEM_DATABASE_URL: 'postgresql://localhost/moltnet_dbos',
    });
    expect(config.server.PORT).toBe(9000);
    expect(config.server.NODE_ENV).toBe('production');
    expect(config.webhook.ORY_ACTION_API_KEY).toBe('test-key');
  });
});
