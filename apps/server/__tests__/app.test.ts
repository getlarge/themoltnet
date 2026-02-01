import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

  it('should throw when STATIC_DIR does not exist', async () => {
    await expect(
      buildApp({
        config: { PORT: 0, NODE_ENV: 'test', STATIC_DIR: '/no/such/path' },
        logger: false,
      }),
    ).rejects.toThrow('STATIC_DIR does not exist: /no/such/path');
  });

  it('should serve static files and SPA fallback when STATIC_DIR is set', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'moltnet-test-'));
    writeFileSync(path.join(dir, 'index.html'), '<html>landing</html>');
    writeFileSync(path.join(dir, 'style.css'), 'body{}');

    const app = await buildApp({
      config: { PORT: 0, NODE_ENV: 'test', STATIC_DIR: dir },
      logger: false,
    });

    // Static file served directly
    const cssResponse = await app.inject({ method: 'GET', url: '/style.css' });
    expect(cssResponse.statusCode).toBe(200);
    expect(cssResponse.body).toBe('body{}');

    // SPA fallback: unknown GET path returns index.html
    const spaResponse = await app.inject({
      method: 'GET',
      url: '/some/spa/route',
    });
    expect(spaResponse.statusCode).toBe(200);
    expect(spaResponse.body).toContain('landing');

    // Non-GET to unknown path still returns 404
    const postResponse = await app.inject({
      method: 'POST',
      url: '/some/spa/route',
    });
    expect(postResponse.statusCode).toBe(404);

    await app.close();
  });

  it('should serve /healthz even when static files are present', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'moltnet-test-'));
    writeFileSync(path.join(dir, 'index.html'), '<html>landing</html>');

    const app = await buildApp({
      config: { PORT: 0, NODE_ENV: 'test', STATIC_DIR: dir },
      logger: false,
    });

    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');

    await app.close();
  });
});
