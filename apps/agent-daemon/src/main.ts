/**
 * agent-daemon — long-running task worker for MoltNet.
 *
 * One process = one VM-per-task = one agent identity (local-only for now).
 *
 * Subcommands:
 *   poll     long-running, claim & execute queued tasks until SIGINT/SIGTERM
 *   once     claim & execute a single task by id, then exit
 *   drain    poll until the queue has nothing claimable, then exit
 *
 * See `--help` on each subcommand for flags. Sandbox config is read from
 * `sandbox.json` in the daemon's working directory; agent credentials
 * from `.moltnet/<agent>/`.
 */
import { runDrain } from './cli/drain.js';
import { runOnce } from './cli/once.js';
import { runPoll } from './cli/poll.js';

const USAGE = `Usage: agent-daemon <command> [...flags]

Commands:
  poll    Long-running worker; claim queued tasks until interrupted
  once    Execute a single queued task by --task-id
  drain   Claim until the queue is empty, then exit

Run \`agent-daemon <command>\` with no flags for command-specific usage.`;

async function main(): Promise<number> {
  const [, , subcommand, ...rest] = process.argv;
  switch (subcommand) {
    case 'poll':
      return runPoll(rest);
    case 'once':
      return runOnce(rest);
    case 'drain':
      return runDrain(rest);
    case undefined:
    case '-h':
    case '--help':
      console.error(USAGE);
      return subcommand === undefined ? 1 : 0;
    default:
      console.error(`Unknown command "${subcommand}"\n\n${USAGE}`);
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
