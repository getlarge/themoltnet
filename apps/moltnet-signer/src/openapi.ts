import swagger from '@fastify/swagger';
import type { FastifyInstance } from 'fastify';

import { SESSION_HEADER, signerSchemaId } from './server.js';

export function registerSignerOpenApi(app: FastifyInstance): void {
  void app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'MoltNet signer companion API',
        description:
          'Private loopback protocol between MoltNet Console and the local signer companion.',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://127.0.0.1:{port}',
          description: 'Local signer companion',
          variables: {
            port: {
              default: '17373',
              description: 'Ephemeral or explicitly configured loopback port',
            },
          },
        },
      ],
      components: {
        securitySchemes: {
          signerSession: {
            type: 'apiKey',
            in: 'header',
            name: SESSION_HEADER,
            description:
              'Short-lived, origin-bound signer companion capability.',
          },
        },
      },
    },
    refResolver: {
      buildLocalReference(json) {
        return signerSchemaId(json);
      },
    },
  });
}
