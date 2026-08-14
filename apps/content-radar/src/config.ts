import { parseArgs } from 'node:util';

import {
  type ContentRadarProfileRouting,
  MAX_DRAFT_TASKS,
  type Watchlist,
} from './types.js';
import { parseWatchlist } from './watchlist.js';

export const HELP = `Usage:
  moltnet-content-radar --validate --watchlist <path>
  moltnet-content-radar --team <uuid> --diary <uuid> --watchlist <path>
    [--profile <uuid|name>] [--scan-profile <uuid|name>]
    [--sweep-profile <uuid|name>] [--correlate-profile <uuid|name>]
    [--draft-profile <uuid|name>]
    [--max-drafts <n>] [--correlation-id <uuid>] [--queue <name>]
    [--agent-dir <path>] [--poll-interval <sec>] [--concurrency <n>]

--validate is read-only: it parses the watchlist, prints the normalized scope
and its digest, and exits. It does not connect, stage artifacts, or create
tasks.

CONTENT_RADAR_DATABASE_URL supplies the Absurd Postgres URL. It stays in the
environment so it is absent from argv and shell history.`;

export interface CliRunConfig {
  databaseUrl: string;
  queueName?: string;
  agentDir?: string;
  watchlist: Watchlist;
  teamId: string;
  diaryId: string;
  correlationId: string;
  maxDrafts: number;
  pollIntervalSec?: number;
  concurrency?: number;
  profileRoutingRefs?: ContentRadarProfileRouting;
}

export interface CliValidateConfig {
  watchlist: Watchlist;
}

export type CliParseResult =
  | { kind: 'help' }
  | { kind: 'validate'; config: CliValidateConfig }
  | { kind: 'run'; config: CliRunConfig };

export interface CliParseDeps {
  env: NodeJS.ProcessEnv;
  readFile(path: string): string;
  randomUUID(): string;
}

export function currentProcessEnv(): NodeJS.ProcessEnv {
  return process.env;
}

function positiveInteger(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function required(value: string | undefined, flag: string): string {
  if (!value || !value.trim()) {
    throw new Error(`${flag} is required`);
  }
  return value.trim();
}

export function parseCliConfig(
  argv: string[],
  deps: CliParseDeps,
): CliParseResult {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      help: { type: 'boolean' },
      validate: { type: 'boolean' },
      watchlist: { type: 'string' },
      team: { type: 'string' },
      diary: { type: 'string' },
      profile: { type: 'string' },
      'scan-profile': { type: 'string' },
      'sweep-profile': { type: 'string' },
      'correlate-profile': { type: 'string' },
      'draft-profile': { type: 'string' },
      'max-drafts': { type: 'string' },
      'correlation-id': { type: 'string' },
      queue: { type: 'string' },
      'agent-dir': { type: 'string' },
      'poll-interval': { type: 'string' },
      concurrency: { type: 'string' },
    },
  });

  if (values.help) return { kind: 'help' };

  const watchlist = parseWatchlist(
    deps.readFile(required(values.watchlist, '--watchlist')),
  );

  if (values.validate) {
    return { kind: 'validate', config: { watchlist } };
  }

  const databaseUrl = deps.env.CONTENT_RADAR_DATABASE_URL;
  if (!databaseUrl || !databaseUrl.trim()) {
    throw new Error('CONTENT_RADAR_DATABASE_URL is required for a durable run');
  }

  const maxDrafts =
    positiveInteger(values['max-drafts'], '--max-drafts') ?? MAX_DRAFT_TASKS;
  if (maxDrafts > MAX_DRAFT_TASKS) {
    throw new Error(`--max-drafts must be at most ${MAX_DRAFT_TASKS}`);
  }

  const defaultProfile = values.profile?.trim();
  const profileRoutingRefs: ContentRadarProfileRouting | undefined =
    defaultProfile
      ? {
          defaultProfileId: defaultProfile,
          ...(values['scan-profile']
            ? { scanProfileId: values['scan-profile'].trim() }
            : {}),
          ...(values['sweep-profile']
            ? { sweepProfileId: values['sweep-profile'].trim() }
            : {}),
          ...(values['correlate-profile']
            ? { correlateProfileId: values['correlate-profile'].trim() }
            : {}),
          ...(values['draft-profile']
            ? { draftProfileId: values['draft-profile'].trim() }
            : {}),
        }
      : undefined;

  if (
    !profileRoutingRefs &&
    (values['scan-profile'] || values['sweep-profile'])
  ) {
    throw new Error('phase profile flags require --profile as the default');
  }

  return {
    kind: 'run',
    config: {
      databaseUrl: databaseUrl.trim(),
      watchlist,
      teamId: required(values.team, '--team'),
      diaryId: required(values.diary, '--diary'),
      correlationId: values['correlation-id']?.trim() || deps.randomUUID(),
      maxDrafts,
      ...(values.queue ? { queueName: values.queue.trim() } : {}),
      ...(values['agent-dir'] ? { agentDir: values['agent-dir'].trim() } : {}),
      ...(values['poll-interval']
        ? {
            pollIntervalSec: positiveInteger(
              values['poll-interval'],
              '--poll-interval',
            ),
          }
        : {}),
      ...(values.concurrency
        ? {
            concurrency: positiveInteger(values.concurrency, '--concurrency'),
          }
        : {}),
      ...(profileRoutingRefs ? { profileRoutingRefs } : {}),
    },
  };
}
