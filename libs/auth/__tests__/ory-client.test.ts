import { describe, it, expect } from 'vitest';
import { createOryClients, type OryClients } from '../src/ory-client.js';

describe('createOryClients', () => {
  it('creates all API instances with provided base URL', () => {
    const clients = createOryClients({
      baseUrl: 'https://test.projects.oryapis.com',
    });

    expect(clients.oauth2).toBeDefined();
    expect(clients.permission).toBeDefined();
    expect(clients.relationship).toBeDefined();
    expect(clients.identity).toBeDefined();
    expect(clients.frontend).toBeDefined();
  });

  it('creates clients with API key for admin endpoints', () => {
    const clients = createOryClients({
      baseUrl: 'https://test.projects.oryapis.com',
      apiKey: 'ory_pat_test_key',
    });

    expect(clients.oauth2).toBeDefined();
    expect(clients.identity).toBeDefined();
  });

  it('returns typed OryClients object', () => {
    const clients: OryClients = createOryClients({
      baseUrl: 'https://test.projects.oryapis.com',
    });

    // Type check: ensure all properties exist
    const keys = Object.keys(clients);
    expect(keys).toContain('oauth2');
    expect(keys).toContain('permission');
    expect(keys).toContain('relationship');
    expect(keys).toContain('identity');
    expect(keys).toContain('frontend');
  });
});
