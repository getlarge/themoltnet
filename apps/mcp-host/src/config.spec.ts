import { describe, expect, it } from 'vitest';

import { readHostConfig } from './config.js';

describe('readHostConfig', () => {
  it('prefers query overrides over runtime defaults', () => {
    const location = new URL(
      'http://localhost:8080/?tool=tasks_app_open&autorun=1&server=http%3A%2F%2Flocalhost%3A8001%2Fmcp&clientId=test-client&clientSecret=test-secret&args=%7B%22status%22%3A%22queued%22%7D',
    ) as unknown as Location;

    const config = readHostConfig(location, {
      autorun: false,
      clientId: 'ignored-client',
      clientSecret: 'ignored-secret',
      defaultArgs: { ignored: true },
      defaultTool: 'teams_list',
      sandboxBaseUrl: 'http://localhost:8081/sandbox.html',
      servers: ['http://localhost:9999/mcp'],
    });

    expect(config.defaultTool).toBe('tasks_app_open');
    expect(config.autorun).toBe(true);
    expect(config.clientId).toBe('test-client');
    expect(config.clientSecret).toBe('test-secret');
    expect(config.defaultArgs).toEqual({ status: 'queued' });
    expect(config.servers).toEqual(['http://localhost:8001/mcp']);
  });
});
