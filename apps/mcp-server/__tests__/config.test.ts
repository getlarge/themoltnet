import { describe, expect, it } from 'vitest';

import {
  loadConfig,
  parseDomainList,
  resolveMcpAppConfig,
  resolveRedisConfig,
} from '../src/config.js';

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

  describe('MCP app configuration', () => {
    it('returns null when MCP_APP_DOMAIN is not set', () => {
      const config = loadConfig({
        PORT: '8001',
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:8080',
      });

      expect(resolveMcpAppConfig(config)).toBeNull();
    });

    it('resolves MCP app config with default connect domains', () => {
      const config = loadConfig({
        PORT: '8001',
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:8080',
        MCP_APP_DOMAIN: 'https://mcp.themolt.net',
      });

      expect(resolveMcpAppConfig(config)).toEqual({
        domain: 'https://mcp.themolt.net',
        connectDomains: ['https://mcp.themolt.net'],
        resourceDomains: [],
        frameDomains: [],
      });
    });

    it('resolves MCP app config with custom domains', () => {
      const config = loadConfig({
        PORT: '8001',
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:8080',
        MCP_APP_DOMAIN: 'https://mcp.themolt.net',
        MCP_APP_CONNECT_DOMAINS:
          'https://api.themolt.net,https://mcp.themolt.net',
        MCP_APP_RESOURCE_DOMAINS: 'https://assets.themolt.net',
        MCP_APP_FRAME_DOMAINS: 'https://embed.themolt.net',
      });

      expect(resolveMcpAppConfig(config)).toEqual({
        domain: 'https://mcp.themolt.net',
        connectDomains: ['https://api.themolt.net', 'https://mcp.themolt.net'],
        resourceDomains: ['https://assets.themolt.net'],
        frameDomains: ['https://embed.themolt.net'],
      });
    });
  });

  describe('parseDomainList', () => {
    it('returns empty array for undefined input', () => {
      expect(parseDomainList(undefined)).toEqual([]);
    });

    it('parses comma-separated domains', () => {
      expect(parseDomainList('https://example.com,https://test.com')).toEqual([
        'https://example.com',
        'https://test.com',
      ]);
    });

    it('trims whitespace from domains', () => {
      expect(
        parseDomainList(' https://example.com , https://test.com '),
      ).toEqual(['https://example.com', 'https://test.com']);
    });

    it('filters out empty domains', () => {
      expect(parseDomainList('https://example.com,,https://test.com')).toEqual([
        'https://example.com',
        'https://test.com',
      ]);
    });
  });
});
