/**
 * OTel auto-instrumentation registration for the agent daemon.
 *
 * This file MUST be imported first in main.ts — before any module that
 * transitively imports http, net, dns, undici (global fetch), or pino. In
 * ESM, imports execute in declaration order, so placing this first guarantees
 * the monkey-patches land before those modules load. In particular:
 *
 *   - UndiciInstrumentation patches `globalThis.fetch` so every outbound SDK
 *     call (@themoltnet/sdk uses global fetch — see libs/sdk/src/connect.ts)
 *     carries a W3C `traceparent` header. That is what links the daemon's
 *     trace to the rest-api server span: one distributed trace, end to end.
 *   - PinoInstrumentation injects `trace_id` / `span_id` into every pino log
 *     record, so logs correlate with the active span in Axiom. It patches
 *     pino at import time — hence the strict ordering requirement. It does
 *     NOT add a transport, so the logger's pino-pretty shutdown dance
 *     (lib/logger.ts, issue #1107) stays valid.
 *
 * The registered instrumentations bind to the global TracerProvider once it
 * is registered by `initWorkerOtel()` (lib/otel.ts, via provider.register()).
 * Registration order is fine: instrumentations created here pick up the
 * provider whenever it is set; spans only flow once it is registered.
 *
 * No `pg` instrumentation — the daemon has no direct database access. No
 * `runtime-node` — that is server-side process metrics, out of scope here.
 */
// Import via the ./instrumentation subpath, not the package root barrel —
// the root re-exports fastify-plugin, the metrics SDK, and log exporters that
// a CLI daemon does not need and would otherwise be pulled into the bundle.
import { initInstrumentation } from '@moltnet/observability/instrumentation';

initInstrumentation({
  http: true,
  dns: true,
  net: true,
  pino: true,
  pg: false,
});
