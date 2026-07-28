// MUST be first: registers OTel auto-instrumentation (undici/pino/http/dns/net)
// before any module that transitively imports those. See instrumentation.ts.
import './instrumentation.js';

import { runAgentDaemonCli } from './cli.js';
import { defaultPiDaemonAdapter } from './pi.js';

runAgentDaemonCli({ runtime: defaultPiDaemonAdapter })
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
