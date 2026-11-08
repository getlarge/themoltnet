import { DCR_MAX_SCOPES } from '@moltnet/models';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  registerProtectedResourceMetadata,
  RESOURCE_SCOPES_SUPPORTED,
} from '../src/well-known-metadata.js';

describe('registerProtectedResourceMetadata', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    registerProtectedResourceMetadata(app, {
      resourceUri: 'https://mcp.example.test/',
      authorizationServers: ['https://auth.example.test'],
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the root document for the resource', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      resource: 'https://mcp.example.test/',
      authorization_servers: ['https://auth.example.test'],
      scopes_supported: [...DCR_MAX_SCOPES],
    });
  });

  it('serves the /mcp variant with the path-suffixed resource', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource/mcp',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      resource: 'https://mcp.example.test/mcp',
      scopes_supported: [...RESOURCE_SCOPES_SUPPORTED],
    });
  });

  it('advertises diary:read and team:read, whose absence broke connectors', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
    });

    expect(response.json().scopes_supported).toEqual(
      expect.arrayContaining(['diary:read', 'team:read']),
    );
  });
});
