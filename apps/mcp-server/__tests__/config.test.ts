import { describe, expect, it } from 'vitest';

import { loadConfig, resolveRedisConfig } from '../src/config.js';

describe('MCP server config', () => {
  it('resolves Redis host and port config', () => {
    const config = loadConfig({
      PORT: '8001',
      NODE_ENV: 'test',
      REST_API_URL: 'http://localhost:8080',
      MCP_REDIS_HOST: 'redis.internal',
      MCP_REDIS_PORT: '6380',
      MCP_REDIS_PASSWORD: 'secret',
      MCP_REDIS_DB: '4',
      MCP_REDIS_TLS: 'true',
    });

    expect(resolveRedisConfig(config)).toEqual({
      host: 'redis.internal',
      port: 6380,
      password: 'secret',
      db: 4,
      tls: {},
    });
  });

  it('resolves Redis URL config and defaults port', () => {
    const config = loadConfig({
      PORT: '8001',
      NODE_ENV: 'test',
      REST_API_URL: 'http://localhost:8080',
      MCP_REDIS_URL: 'rediss://:password@cache.internal/7',
    });

    expect(resolveRedisConfig(config)).toEqual({
      host: 'cache.internal',
      port: 6379,
      password: 'password',
      db: 7,
      tls: {},
    });
  });

  it('returns null when Redis is not configured', () => {
    const config = loadConfig({
      PORT: '8001',
      NODE_ENV: 'test',
      REST_API_URL: 'http://localhost:8080',
    });

    expect(resolveRedisConfig(config)).toBeNull();
  });
});
