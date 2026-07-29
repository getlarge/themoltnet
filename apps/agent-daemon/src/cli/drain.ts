import { DRAIN_HELP } from '../lib/help.js';
import type { DaemonRuntimeAdapter } from '../runtime.js';
import { runPolling } from './poll-shared.js';

export function runDrain(
  argv: string[],
  runtimeAdapter?: DaemonRuntimeAdapter,
): Promise<number> {
  return runPolling({
    argv,
    serviceName: 'moltnet.agent-daemon.drain',
    stopWhenEmpty: true,
    modeLabel: 'drain',
    helpText: DRAIN_HELP,
    runtimeAdapter,
  });
}
