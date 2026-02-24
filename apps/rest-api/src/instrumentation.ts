/**
 * OTel auto-instrumentation registration.
 *
 * This file MUST be imported first in main.ts — before any module that
 * transitively imports pg, http, net, dns, or pino. In ESM, imports execute
 * in declaration order, so placing this first guarantees the monkey-patches
 * land before those modules load.
 */
import { initInstrumentation } from '@moltnet/observability';

initInstrumentation({
  http: true,
  dns: true,
  net: true,
  pg: true,
  pino: true,
  httpIgnoreIncomingPaths: ['/health', '/ready'],
});
