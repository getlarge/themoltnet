import { DCR_MAX_SCOPES } from '@moltnet/models';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  registerWellKnownMetadata,
  RESOURCE_SCOPES_SUPPORTED,
} from '../src/well-known-metadata.js';

/**
 * Mirrors the response schema `@getlarge/fastify-mcp` puts on its
 * protected-resource routes. It is the reason the patch has to run in
 * `onSend`: Fastify drops undeclared properties at serialization, so a route
 * built like this cannot emit `scopes_supported` no matter what the handler
 * returns.
 */
const PROTECTED_RESOURCE_SCHEMA = {
  response: {
    200: {
      type: 'object',
      properties: {
        resource: { type: 'string' },
        authorization_servers: { type: 'array', items: { type: 'string' } },
      },
      required: ['resource', 'authorization_servers'],
    },
  },
} as const;

async function buildStubServer(
  extraRoutes?: (app: FastifyInstance) => void,
): Promise<FastifyInstance> {
  const app = Fastify();
  registerWellKnownMetadata(app);

  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ]) {
    app.get(path, { schema: PROTECTED_RESOURCE_SCHEMA }, async () => ({
      resource: 'https://mcp.example.test',
      authorization_servers: ['https://auth.example.test'],
      // Declared nowhere in the schema, so Fastify strips it — exactly as the
      // real plugin behaves.
      scopes_supported: ['should-be-stripped'],
    }));
  }

  app.get('/.well-known/openid-configuration/mcp', async () => ({
    issuer: 'https://auth.example.test',
    scopes_supported: ['read', 'write', 'mcp:resources'],
  }));

  extraRoutes?.(app);

  await app.ready();
  return app;
}

describe('registerWellKnownMetadata', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('advertises the full scope set on both protected resource documents', async () => {
    // Arrange
    app = await buildStubServer();

    for (const url of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      // Act
      const response = await app.inject({ method: 'GET', url });

      // Assert
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.scopes_supported).toEqual([...DCR_MAX_SCOPES]);
      expect(body.resource).toBe('https://mcp.example.test');
      expect(body.authorization_servers).toEqual(['https://auth.example.test']);
    }
  });

  it('advertises team:read, the scope whose absence broke connector authorization', async () => {
    // Arrange
    app = await buildStubServer();

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
    });

    // Assert
    expect(response.json().scopes_supported).toContain('team:read');
    expect(RESOURCE_SCOPES_SUPPORTED).toContain('team:read');
  });

  it('reports a content-length matching the rewritten body', async () => {
    // Arrange
    app = await buildStubServer();

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
    });

    // Assert
    expect(Number(response.headers['content-length'])).toBe(
      Buffer.byteLength(response.body),
    );
  });

  it('replaces the fabricated scopes on the OIDC discovery document', async () => {
    // Arrange
    app = await buildStubServer();

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/.well-known/openid-configuration/mcp',
    });

    // Assert
    const body = response.json();
    expect(body.scopes_supported).toEqual([...DCR_MAX_SCOPES]);
    expect(body.scopes_supported).not.toContain('mcp:resources');
    expect(body.issuer).toBe('https://auth.example.test');
  });

  it('ignores unrelated routes and non-GET requests', async () => {
    // Arrange
    app = await buildStubServer((instance) => {
      instance.get('/healthz', async () => ({ status: 'ok' }));
      instance.post('/.well-known/oauth-protected-resource', async () => ({
        resource: 'https://mcp.example.test',
      }));
    });

    // Act
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    const posted = await app.inject({
      method: 'POST',
      url: '/.well-known/oauth-protected-resource',
    });

    // Assert
    expect(health.json()).toEqual({ status: 'ok' });
    expect(posted.json().scopes_supported).toBeUndefined();
  });

  it('leaves a non-200 response untouched', async () => {
    // Arrange
    app = await buildStubServer((instance) => {
      instance.get(
        '/.well-known/oauth-protected-resource/missing',
        async (_r, reply) => reply.code(404).send({ message: 'not found' }),
      );
    });

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource/missing',
    });

    // Assert
    expect(response.statusCode).toBe(404);
    expect(response.json().scopes_supported).toBeUndefined();
  });
});
