import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

describe('server app', () => {
  it('should return health check', async () => {
    const app = await buildApp({
      config: { PORT: 0, NODE_ENV: 'test' },
      logger: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();

    await app.close();
  });

  it('should return 404 for non-GET requests when no static dir', async () => {
    const app = await buildApp({
      config: { PORT: 0, NODE_ENV: 'test' },
      logger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/nonexistent',
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
