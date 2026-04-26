import { runDrain } from './cli/drain.js';
import { runOnce } from './cli/once.js';
import { runPoll } from './cli/poll.js';
import { ROOT_USAGE } from './lib/help.js';

async function main(): Promise<number> {
  const [, , subcommand, ...rest] = process.argv;
  switch (subcommand) {
    case 'poll':
      return runPoll(rest);
    case 'once':
      return runOnce(rest);
    case 'drain':
      return runDrain(rest);
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

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
