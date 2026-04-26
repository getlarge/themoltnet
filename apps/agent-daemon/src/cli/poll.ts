import { runPolling } from './poll-shared.js';

export function runPoll(argv: string[]): Promise<number> {
  return runPolling({
    argv,
    serviceName: 'moltnet.agent-daemon.poll',
    stopWhenEmpty: false,
    modeLabel: 'poll',
  });
}
