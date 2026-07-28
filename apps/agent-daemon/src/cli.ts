import { runDrain } from './cli/drain.js';
import { runOnce } from './cli/once.js';
import { runPoll } from './cli/poll.js';
import { runSyncSessions } from './cli/sync-sessions.js';
import { ROOT_USAGE } from './lib/help.js';
import type { DaemonRuntimeAdapter } from './runtime.js';

export async function runAgentDaemonCli(options: {
  runtime: DaemonRuntimeAdapter;
  argv?: string[];
}): Promise<number> {
  const [subcommand, ...rest] = options.argv ?? process.argv.slice(2);
  switch (subcommand) {
    case 'poll':
      return runPoll(rest, options.runtime);
    case 'once':
      return runOnce(rest, options.runtime);
    case 'drain':
      return runDrain(rest, options.runtime);
    case 'sync-sessions':
      return runSyncSessions(rest);
    case '-h':
    case '--help':
      console.log(ROOT_USAGE);
      return 0;
    case undefined:
      console.error(ROOT_USAGE);
      return 1;
    default:
      console.error(`Unknown command "${subcommand}"\n\n${ROOT_USAGE}`);
      return 1;
  }
}
