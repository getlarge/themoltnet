import { IdentityApi } from '@ory/client-fetch';
import { describe, expect, it } from 'vitest';

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

  it('patches listIdentitySchemas to use public URL when URLs differ', () => {
    const clients = createOryClients({
      baseUrl: 'https://test.projects.oryapis.com',
      kratosAdminUrl: 'http://kratos:4434',
      kratosPublicUrl: 'http://kratos:4433',
    });

    // The patched method should NOT be the same as the admin instance's
    // prototype method — it should be bound to a public-URL instance
    const adminProto = IdentityApi.prototype.listIdentitySchemas;
    expect(clients.identity.listIdentitySchemas).not.toBe(adminProto);
  });

  it('does not patch listIdentitySchemas when URLs are the same', () => {
    const unpatched = new IdentityApi();
    const original = unpatched.listIdentitySchemas;

    const clients = createOryClients({
      baseUrl: 'https://test.projects.oryapis.com',
      kratosAdminUrl: 'http://kratos:4434',
      kratosPublicUrl: 'http://kratos:4434',
    });

    // When admin and public URLs match, no patching needed
    expect(clients.identity.listIdentitySchemas.toString()).toBe(
      original.toString(),
    );
  });

  it('does not patch listIdentitySchemas when public URL is not set', () => {
    const unpatched = new IdentityApi();
    const original = unpatched.listIdentitySchemas;

    const clients = createOryClients({
      baseUrl: 'https://test.projects.oryapis.com',
      kratosAdminUrl: 'http://kratos:4434',
    });

    // When public URL is not provided, no patching
    expect(clients.identity.listIdentitySchemas.toString()).toBe(
      original.toString(),
    );
  });
});
