import { describe, expect, it } from 'vitest';

import { bootstrap } from '../src/app.js';

describe('server bootstrap', () => {
  it('should throw when DATABASE_URL is not set', async () => {
    await expect(
      bootstrap({
        server: { PORT: 0, NODE_ENV: 'test' },
        database: {},
        webhook: { ORY_ACTION_API_KEY: 'test-key' },
        recovery: { RECOVERY_CHALLENGE_SECRET: 'secret-at-least-16-chars' },
        ory: { ORY_PROJECT_URL: 'http://localhost:4444' },
        observability: {},
        security: {
          CORS_ORIGINS: 'http://localhost:3000',
          RATE_LIMIT_GLOBAL_AUTH: 100,
          RATE_LIMIT_GLOBAL_ANON: 30,
          RATE_LIMIT_EMBEDDING: 20,
          RATE_LIMIT_VOUCH: 10,
        },
      }),
    ).rejects.toThrow('DATABASE_URL is required');
  });
});
