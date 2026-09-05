import { pino } from 'pino';

import { runDrain } from './cli/drain.js';
import { runOnce } from './cli/once.js';
import { runPoll } from './cli/poll.js';
import { runAgentServer } from './cli/server.js';
import { runSyncSessions } from './cli/sync-sessions.js';
import { loadAgentServerEnvConfig } from './config.js';
import { RuntimeRegistry } from './lib/agent-server/runtime-registry.js';
import { resolveAgentServerRoot } from './lib/agent-server/store.js';
import { ROOT_USAGE } from './lib/help.js';
import { checkDaemonUpdate } from './lib/update.js';
import type { DaemonRuntimeAdapter } from './runtime.js';
import { DAEMON_VERSION } from './version.js';

export async function runAgentDaemonCli(options: {
  runtime: DaemonRuntimeAdapter;
  argv?: string[];
}): Promise<number> {
  const [subcommand, ...rest] = options.argv ?? process.argv.slice(2);
  if (
    ['poll', 'drain', 'serve'].includes(subcommand ?? '') &&
    !isWorkspaceInvocation()
  ) {
    void checkDaemonUpdate({ currentVersion: DAEMON_VERSION })
      .then((update) => {
        if (update.updateAvailable) {
          pino({ name: 'moltnet.agent-daemon' }).info(
            { event: 'agent-daemon.update_available', update },
            'A MoltNet agent update is available',
          );
        }
      })
      .catch(() => undefined);
  }
  switch (subcommand) {
    case 'poll':
      return runPoll(rest, options.runtime);
    case 'once':
      return runOnce(rest, options.runtime);
    case 'drain':
      return runDrain(rest, options.runtime);
    case 'server':
      return runAgentServer(rest);
    case 'sync-sessions':
      return runSyncSessions(rest);
    case 'update':
      return runUpdate(rest);
    case 'runtime':
      return runRuntime(rest);
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

function isWorkspaceInvocation(): boolean {
  return (process.argv[1] ?? '')
    .replaceAll('\\', '/')
    .includes('/apps/agent-daemon/src/');
}

async function runUpdate(argv: string[]): Promise<number> {
  if (argv[0] !== 'check' || argv.slice(1).some((arg) => arg !== '--json')) {
    console.error('Usage: moltnet-agent update check [--json]');
    return 1;
  }
  try {
    const update = await checkDaemonUpdate({
      currentVersion: DAEMON_VERSION,
      force: true,
    });
    if (argv.includes('--json')) console.log(JSON.stringify(update));
    else if (update.updateAvailable)
      console.log(
        `MoltNet agent ${update.latestVersion} is available (you have ${update.currentVersion}). Run: ${update.command}`,
      );
    else console.log(`MoltNet agent ${update.currentVersion} is up to date.`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function runRuntime(argv: string[]): Promise<number> {
  const config = loadAgentServerEnvConfig();
  const registry = new RuntimeRegistry(
    resolveAgentServerRoot({ root: config.root }),
  );
  const [command, ...rest] = argv;
  if (command === 'list') {
    console.log(JSON.stringify(registry.list(), null, 2));
    return 0;
  }
  if (command === 'unregister' && rest.length === 1) {
    if (!registry.unregister(rest[0])) {
      throw new Error(`No runtime registered for "${rest[0]}".`);
    }
    return 0;
  }
  if (command === 'register' && rest.length === 2) {
    console.log(
      JSON.stringify(await registry.register(rest[0], rest[1]), null, 2),
    );
    return 0;
  }
  console.error(
    'Usage: moltnet-agent runtime <list|register <kind> <module>|unregister <kind>>',
  );
  return 1;
}
