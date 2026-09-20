import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { loadConfig } from '../config.js';
import {
  resolveAgentContext,
  resolveSelectionApiUrl,
  validateStartupBinding,
} from '../lib/agent-context.js';
import { isHelpFlag, SYNC_SESSIONS_HELP } from '../lib/help.js';
import {
  identityOptionDefs,
  MissingRequiredOptionError,
  parseIdentityProcessOptions,
} from '../lib/options.js';
import {
  projectRunOptionDefs,
  resolveRunProjectSelection,
} from '../lib/run-project-selection.js';
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
      ...identityOptionDefs(),
      ...projectRunOptionDefs(),
      team: { type: 'string' },
      'runtime-profile-id': { type: 'string' },
      state: { type: 'string' },
      limit: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });

  let identity: ReturnType<typeof parseIdentityProcessOptions>;
  try {
    identity = parseIdentityProcessOptions(values);
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
  // Credential resolution only follows --agent-root when it was actually
  // passed; the cwd default seeds daemon state dirs, not identity discovery.
  const explicitAgentRootDir = values['agent-root']
    ? resolve(process.cwd(), values['agent-root'])
    : undefined;
  const cfg = loadConfig();
  let selection: Awaited<ReturnType<typeof resolveRunProjectSelection>>;
  try {
    const apiUrl = await resolveSelectionApiUrl(identity.agent, {
      agentRootDir: explicitAgentRootDir,
      credentialSource: cfg.credentialSource,
      envApiUrl: cfg.apiUrl,
    });
    selection = await resolveRunProjectSelection({
      ...values,
      agent: identity.agent,
      cwd: process.cwd(),
      apiUrl,
    });
    if (!selection.teamId)
      throw new Error('Select --team or a binding with a team');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(SYNC_SESSIONS_HELP);
    return 1;
  }
  const ctx = await resolveAgentContext(identity.agent, {
    // Without this the resolver always takes the config path, so a configless
    // MOLTNET_AGENT_KEY run demands a moltnet.json it was never meant to have.
    credentialSource: cfg.credentialSource,
    envApiUrl: cfg.apiUrl,
    projectApiUrl: selection.binding?.apiUrl,
    teamId: selection.teamId,
    agentRootDir: explicitAgentRootDir,
  });
  // Fail fast on a rejected or wrong-team credential before touching sessions.
  await validateStartupBinding({
    agent: ctx.agent,
    teamId: selection.teamId,
    credentialTeamId: ctx.credentialTeamId,
  });
  const stateDirs = ensureDaemonStateDirs(
    selection.stateRootDir ??
      (selection.binding || values.source
        ? (selection.source ?? agentRootDir)
        : agentRootDir),
  );
  const result = await syncRuntimeSessions(
    {
      runtimeSessionStore: createApiRuntimeSessionStore({ agent: ctx.agent }),
      runtimeSlotStore: createApiRuntimeSlotStore({ agent: ctx.agent }),
      taskReader: ctx.agent.tasks,
    },
    {
      agentName: identity.agent,
      dryRun: values['dry-run'] === true,
      limit,
      runtimeProfileId: values['runtime-profile-id'],
      sessionRootDir: stateDirs.piSessionsDir,
      state,
      teamId: selection.teamId,
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
