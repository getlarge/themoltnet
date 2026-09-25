import { describe, expect, it } from 'vitest';

import { createMockServices, createTestApp } from './helpers.js';

describe('OpenAPI agent key authentication', () => {
  it('offers agent keys as an alternative only where accepted', async () => {
    const app = await createTestApp(createMockServices(), null);
    try {
      await app.ready();
      const spec = app.swagger();
      expect(spec.components?.securitySchemes?.agentKeyAuth).toMatchObject({
        type: 'http',
        scheme: 'bearer',
      });

      const securityFor = (path: string, method: string) =>
        (
          spec.paths?.[path] as
            | Record<string, { security?: object[] }>
            | undefined
        )?.[method]?.security;

      expect(securityFor('/agents/whoami', 'get')).toContainEqual({
        agentKeyAuth: [],
      });
      expect(securityFor('/projects', 'get')).toContainEqual({
        agentKeyAuth: [],
      });
      expect(
        securityFor('/executor-manifests/register', 'post'),
      ).toContainEqual({
        agentKeyAuth: [],
      });

      for (const [path, method] of [
        ['/agents/whoami', 'patch'],
        ['/agents/whoami/alias', 'delete'],
        ['/oauth2/provision', 'post'],
      ]) {
        expect(securityFor(path, method)).not.toContainEqual({
          agentKeyAuth: [],
        });
      }
    } finally {
      await app.close();
    }
  });
});
