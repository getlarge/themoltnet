/**
 * OTel auto-instrumentation for the MCP server.
 * No pg/net — MCP server does not access the database directly.
 * MUST be the first import in main.ts.
 */
import { initInstrumentation } from '@moltnet/observability';

initInstrumentation({
  http: true,
  dns: true,
  net: false,
  pg: false,
  pino: true,
  httpIgnoreIncomingPaths: ['/healthz', '/healthz/ready'],
});
