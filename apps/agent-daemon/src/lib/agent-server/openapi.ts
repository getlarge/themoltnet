import swagger from '@fastify/swagger';
import type { FastifyInstance } from 'fastify';

import { AGENT_SERVER_TOKEN_HEADER } from './server.js';

export function registerAgentServerOpenApi(app: FastifyInstance): void {
  void app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'MoltNet Agent Server API',
        description:
          'Private loopback protocol between MoltNet Console and the local agent daemon server.',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://127.0.0.1:{port}',
          description: 'Local Agent Server',
          variables: {
            port: {
              default: '17374',
              description: 'Agent Server loopback port',
            },
          },
        },
      ],
      components: {
        securitySchemes: {
          agentServerToken: {
            type: 'apiKey',
            in: 'header',
            name: AGENT_SERVER_TOKEN_HEADER,
            description: 'Origin-bound capability issued by local pairing.',
          },
        },
      },
    },
    refResolver: {
      buildLocalReference(json) {
        const id = (json as { $id?: unknown }).$id;
        return typeof id === 'string' ? id : 'AgentServerSchema';
      },
    },
  });
}
