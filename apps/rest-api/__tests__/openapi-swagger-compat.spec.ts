import { describe, expect, it } from 'vitest';

import { createMockServices, createTestApp } from './helpers.js';

describe('OpenAPI Swagger compatibility', () => {
  it('keeps artifact encoding parameters and requires signing transition bodies', async () => {
    const app = await createTestApp(createMockServices(), null);
    try {
      await app.ready();
      const spec = app.swagger();
      // Narrow the Swagger 2 | OpenAPI 3 union: this app emits OpenAPI 3.
      if (!('openapi' in spec)) {
        throw new Error('expected an OpenAPI 3 document');
      }

      for (const path of [
        '/task-artifacts/staged',
        '/tasks/{taskId}/attempts/{attemptN}/artifacts',
      ]) {
        const operation = spec.paths?.[path]?.put;
        expect(operation?.parameters).toContainEqual(
          expect.objectContaining({
            in: 'query',
            name: 'contentEncoding',
            required: false,
            schema: expect.objectContaining({ type: 'string' }),
          }),
        );
        expect(operation?.requestBody).toMatchObject({ required: true });
      }

      for (const action of ['approve', 'suspend', 'revoke']) {
        const operation =
          spec.paths?.[`/crypto/signing-credentials/{id}/${action}`]?.post;
        expect(operation?.requestBody).toBeDefined();
        expect(operation?.requestBody).toMatchObject({ required: true });
      }
    } finally {
      await app.close();
    }
  });
});
