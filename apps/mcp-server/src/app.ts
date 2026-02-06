import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import Fastify, { type FastifyInstance } from 'fastify';

import type { McpServerConfig } from './config.js';
import { createMcpServer } from './server.js';
import type { McpDeps } from './types.js';

export interface AppOptions {
  config: McpServerConfig;
  deps: McpDeps;
  logger?: boolean | object;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config: _config, deps, logger = true } = options;

  const app = Fastify({ logger });

  // Health check
  app.get('/healthz', () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Session storage
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // MCP POST endpoint — initialization + JSON-RPC requests
  app.post('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;

    let transport: StreamableHTTPServerTransport;

    if (sessionId) {
      const existing = transports.get(sessionId);
      if (!existing) {
        return reply.status(400).send({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID' },
          id: null,
        });
      }
      transport = existing;
    } else if (isInitializeRequest(request.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
      };

      const server = createMcpServer(deps);
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
      return reply;
    } else {
      return reply.status(400).send({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID' },
        id: null,
      });
    }

    await transport.handleRequest(request.raw, reply.raw, request.body);
    return reply;
  });

  // MCP GET endpoint — SSE streams
  app.get('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      return reply.status(400).send('Invalid or missing session ID');
    }
    await transport.handleRequest(request.raw, reply.raw);
    return reply;
  });

  // MCP DELETE endpoint — session termination
  app.delete('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      return reply.status(400).send('Invalid or missing session ID');
    }
    await transport.handleRequest(request.raw, reply.raw);
    return reply;
  });

  // Clean up transports on server close
  app.addHook('onClose', async () => {
    for (const [, t] of transports) {
      await t.close();
    }
    transports.clear();
  });

  return app;
}
