import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { resolveAgentContext } from '../lib/agent-context.js';
import { isHelpFlag, SYNC_SESSIONS_HELP } from '../lib/help.js';
import {
  commonOptionDefs,
  MissingRequiredOptionError,
  parseCommonOptions,
} from '../lib/options.js';
import { syncRuntimeSessions } from '../lib/runtime-session-sync.js';
import { createApiRuntimeSessionStore } from '../lib/runtime-sessions.js';
import { createApiRuntimeSlotStore } from '../lib/runtime-slots.js';
import { ensureDaemonStateDirs } from '../lib/state-dir.js';

export async function runSyncSessions(argv: string[]): Promise<number> {
  if (isHelpFlag(argv)) {
    console.log(SYNC_SESSIONS_HELP);
    return 0;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      ...commonOptionDefs(),
      team: { type: 'string' },
      'runtime-profile-id': { type: 'string' },
      state: { type: 'string' },
      limit: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });

  if (!values.team) {
    console.error('Missing required flag: --team\n');
    console.error(SYNC_SESSIONS_HELP);
    return 1;
  }

  let opts: ReturnType<typeof parseCommonOptions>;
  try {
    opts = parseCommonOptions(values);
  } catch (err) {
    if (err instanceof MissingRequiredOptionError) {
      console.error(`${err.message}\n`);
      console.error(SYNC_SESSIONS_HELP);
      return 1;
    }
    throw err;
  }

  const state = parseState(values.state);
  const limit = parseLimit(values.limit);
  const agentRootDir = resolve(
    process.cwd(),
    values['agent-root'] ?? process.cwd(),
  );
  const ctx = await resolveAgentContext(opts.agent, { agentRootDir });
  const stateDirs = ensureDaemonStateDirs(agentRootDir);
  const result = await syncRuntimeSessions(
    {
      runtimeSessionStore: createApiRuntimeSessionStore({ agent: ctx.agent }),
      runtimeSlotStore: createApiRuntimeSlotStore({ agent: ctx.agent }),
      taskReader: ctx.agent.tasks,
    },
    {
      agentName: opts.agent,
      dryRun: values['dry-run'] === true,
      limit,
      runtimeProfileId: values['runtime-profile-id'],
      sessionRootDir: stateDirs.piSessionsDir,
      state,
      teamId: values.team,
    },
  );

  console.log(JSON.stringify(result, null, 2));
  return result.failedUpload > 0 || result.unsafeSessionPath > 0 ? 1 : 0;
}

function parseState(raw: string | undefined): 'active' | 'idle' | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'active' || raw === 'idle') return raw;
  throw new Error(`Invalid --state "${raw}": expected active or idle`);
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new Error(`Invalid --limit "${raw}": expected integer 1..200`);
  }
  return value;
}
