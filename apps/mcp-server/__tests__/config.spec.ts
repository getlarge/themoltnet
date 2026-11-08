import { describe, expect, it } from 'vitest';

import {
  loadConfig,
  parseDomainList,
  resolveMcpAppConfig,
} from '../src/config.js';

describe('MCP server config', () => {
  it('loads the OpenAI public plugin challenge token', () => {
    const config = loadConfig({
      REST_API_URL: 'http://localhost:8080',
      OPENAI_APPS_CHALLENGE_TOKEN: 'challenge-token',
    });

    expect(config.OPENAI_APPS_CHALLENGE_TOKEN).toBe('challenge-token');
  });

  it('parses per-signal Axiom dataset config', () => {
    const config = loadConfig({
      PORT: '8001',
      NODE_ENV: 'test',
      REST_API_URL: 'http://localhost:8080',
      AXIOM_API_TOKEN: 'xaat-xxx',
      OTLP_ENDPOINT: 'https://api.axiom.co',
      AXIOM_DATASET: 'legacy',
      AXIOM_LOGS_DATASET: 'logs',
      AXIOM_TRACES_DATASET: 'traces',
      AXIOM_METRICS_DATASET: 'metrics',
    });

    expect(config.AXIOM_API_TOKEN).toBe('xaat-xxx');
    expect(config.OTLP_ENDPOINT).toBe('https://api.axiom.co');
    expect(config.AXIOM_DATASET).toBe('legacy');
    expect(config.AXIOM_LOGS_DATASET).toBe('logs');
    expect(config.AXIOM_TRACES_DATASET).toBe('traces');
    expect(config.AXIOM_METRICS_DATASET).toBe('metrics');
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

    it('keeps MCP app connect domains empty by default', () => {
      const config = loadConfig({
        PORT: '8001',
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:8080',
        MCP_APP_DOMAIN: 'https://mcp.themolt.net',
      });

      expect(resolveMcpAppConfig(config)).toEqual({
        domain: 'https://mcp.themolt.net',
        connectDomains: [],
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
