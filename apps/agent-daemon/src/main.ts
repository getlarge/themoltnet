// MUST be first: registers OTel auto-instrumentation (undici/pino/http/dns/net)
// before any module that transitively imports those. See instrumentation.ts.
import './instrumentation.js';

import { runAgentDaemonCli } from './cli.js';
import { installSupervisorParentGuard } from './lib/supervisor-parent-guard.js';
import { defaultPiDaemonAdapter } from './pi.js';
import {
  extractRuntimeModule,
  loadDaemonRuntimeAdapter,
} from './runtime-loader.js';

installSupervisorParentGuard();

async function main(): Promise<number> {
  const selection = extractRuntimeModule(process.argv.slice(2));
  const runtime = selection.specifier
    ? await loadDaemonRuntimeAdapter(selection.specifier)
    : defaultPiDaemonAdapter;
  return runAgentDaemonCli({ runtime, argv: selection.argv });
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
