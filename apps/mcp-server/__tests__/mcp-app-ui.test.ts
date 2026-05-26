import { describe, expect, it } from 'vitest';

import {
  createMcpAppResourceMeta,
  createMcpAppToolMeta,
} from '../src/mcp-app-ui.js';

describe('MCP App UI', () => {
  describe('createMcpAppResourceMeta', () => {
    it('creates minimal metadata without options', () => {
      const meta = createMcpAppResourceMeta();
      expect(meta).toEqual({
        ui: {
          csp: {
            connectDomains: [],
            resourceDomains: [],
            frameDomains: [],
          },
          prefersBorder: false,
        },
      });
    });

    it('includes domain when provided', () => {
      const meta = createMcpAppResourceMeta({
        domain: 'https://mcp.themolt.net',
      });
      expect(meta).toEqual({
        ui: {
          domain: 'https://mcp.themolt.net',
          csp: {
            connectDomains: [],
            resourceDomains: [],
            frameDomains: [],
          },
          prefersBorder: false,
        },
      });
    });

    it('sets CSP domains when provided', () => {
      const meta = createMcpAppResourceMeta({
        connectDomains: ['https://api.themolt.net'],
        resourceDomains: ['https://assets.themolt.net'],
        frameDomains: ['https://embed.themolt.net'],
        prefersBorder: true,
      });
      expect(meta).toEqual({
        ui: {
          csp: {
            connectDomains: ['https://api.themolt.net'],
            resourceDomains: ['https://assets.themolt.net'],
            frameDomains: ['https://embed.themolt.net'],
          },
          prefersBorder: true,
        },
      });
    });

    it('combines domain and CSP configuration', () => {
      const meta = createMcpAppResourceMeta({
        domain: 'https://mcp.themolt.net',
        connectDomains: ['https://api.themolt.net', 'https://mcp.themolt.net'],
        resourceDomains: ['https://assets.themolt.net'],
        frameDomains: ['https://embed.themolt.net'],
        prefersBorder: true,
      });
      expect(meta).toEqual({
        ui: {
          domain: 'https://mcp.themolt.net',
          csp: {
            connectDomains: [
              'https://api.themolt.net',
              'https://mcp.themolt.net',
            ],
            resourceDomains: ['https://assets.themolt.net'],
            frameDomains: ['https://embed.themolt.net'],
          },
          prefersBorder: true,
        },
      });
    });
  });

  describe('createMcpAppToolMeta', () => {
    it('creates tool metadata with resource URI', () => {
      const meta = createMcpAppToolMeta('ui://moltnet/tasks.html');
      expect(meta).toEqual({
        ui: {
          resourceUri: 'ui://moltnet/tasks.html',
          visibility: ['model', 'app'],
        },
      });
    });
  });
});
