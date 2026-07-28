import { POLL_HELP } from '../lib/help.js';
import type { DaemonRuntimeAdapter } from '../runtime.js';
import { runPolling } from './poll-shared.js';

export function runPoll(
  argv: string[],
  runtimeAdapter?: DaemonRuntimeAdapter,
): Promise<number> {
  return runPolling({
    argv,
    serviceName: 'moltnet.agent-daemon.poll',
    stopWhenEmpty: false,
    modeLabel: 'poll',
    helpText: POLL_HELP,
    runtimeAdapter,
  });
}
