import { parseArgs } from 'node:util';

import type { GitHubFileMetadata } from './review-input.js';
import type { MultiLensReviewInput, ReviewLane } from './types.js';

export const HELP = `Usage:
  moltnet-multi-lens-review --preflight --diff-file <path> [--files-metadata <json>]
    [--review-base-revision <40-hex-object-id>]
  moltnet-multi-lens-review --team <uuid> --diary <uuid> --target <description>
    --diff-file <path> --review-base-revision <40-hex-object-id>
    --review-revision <40-hex-object-id>
    [--files-metadata <json>] [--lens <name> ...]
    [--profile <uuid|name>] [--lens-profile <lane>=<uuid|name> ...]
    [--planner-profile <uuid|name>] [--preflight-profile <uuid|name>]
    [--topic-reducer-profile <uuid|name>]
    [--synthesis-profile <uuid|name>] [--global-synthesis-profile <uuid|name>]
    [--planner-task-id <uuid>]
    [--preflight-task-id <uuid>] [--topic-task-id <uuid> ...]
    [--correlation-id <uuid>] [--queue <name>] [--agent-dir <path>]
    [--poll-interval <sec>] [--concurrency <n>] [--unattended]

--preflight is read-only: it prints classification, exclusions, budgets, and
whether agent planning is required. It does not connect, stage artifacts, or
create tasks.

Existing --profile, --lens-profile, and --synthesis-profile routing remains
supported, including the legacy test-coverage lane alias for tests.
Phase-specific flags override the default for planner, design
preflight, combined topic review (legacy --topic-reducer-profile), and global
synthesis.

--planner-task-id reuses one already accepted planner task after trusted
identity, manifest-reference, and runtime-profile validation. It does not copy
the plan payload into the durable-workflow database.

--preflight-task-id and repeatable --topic-task-id reuse accepted phase tasks
from an interrupted run. Trusted orchestration validates their exact revision,
artifact binding, lane set, output, and runtime profile before accepting them.`;

export interface RuntimeProfileRoutingRefs {
  defaultProfile: string;
  plannerProfile?: string;
  preflightProfile?: string;
  laneProfiles?: Partial<Record<ReviewLane, string>>;
  topicReducerProfile?: string;
  globalSynthesisProfile?: string;
}

type RunInput = Omit<MultiLensReviewInput, 'reviewManifest'>;

export interface CliRunConfig {
  databaseUrl: string;
  queueName?: string;
  agentDir?: string;
  diff: string;
  githubFiles?: GitHubFileMetadata[];
  input: RunInput;
  profileRoutingRefs?: RuntimeProfileRoutingRefs;
}

export interface CliPreflightConfig {
  diff: string;
  githubFiles?: GitHubFileMetadata[];
  reviewBaseRevision?: string;
}

export type CliParseResult =
  | { kind: 'help' }
  | { kind: 'preflight'; config: CliPreflightConfig }
  | { kind: 'run'; config: CliRunConfig };

export interface CliParseDeps {
  env: NodeJS.ProcessEnv;
  readFile(path: string): string;
  randomUUID(): string;
}

export function currentProcessEnv(): NodeJS.ProcessEnv {
  return process.env;
}

function positiveInt(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer (got "${raw}")`);
  }
  return value;
}

function nonEmpty(raw: string, flag: string): string {
  const value = raw.trim();
  if (!value) throw new Error(`${flag} must not be empty`);
  return value;
}

function parseProfiles(
  values: string[] | undefined,
  flag: string,
): Record<string, string> | undefined {
  if (!values?.length) return undefined;
  const parsed: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf('=');
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`${flag} must use <lane>=<uuid|name> (got "${value}")`);
    }
    const lane = nonEmpty(value.slice(0, separator), `${flag} lane`);
    if (Object.hasOwn(parsed, lane)) {
      throw new Error(`${flag} was repeated for lane "${lane}"`);
    }
    parsed[lane] = nonEmpty(value.slice(separator + 1), `${flag} profile`);
  }
  return parsed;
}

function parseMetadata(
  path: string | undefined,
  deps: CliParseDeps,
): GitHubFileMetadata[] | undefined {
  if (!path) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(deps.readFile(path));
  } catch {
    throw new Error('--files-metadata must contain valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('--files-metadata JSON must be an array');
  }
  return parsed as GitHubFileMetadata[];
}

export function parseCliConfig(
  argv: string[],
  deps: CliParseDeps,
): CliParseResult {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h' },
      preflight: { type: 'boolean' },
      team: { type: 'string' },
      diary: { type: 'string' },
      target: { type: 'string' },
      diff: { type: 'string' },
      'diff-file': { type: 'string' },
      'files-metadata': { type: 'string' },
      lens: { type: 'string', multiple: true },
      synthesis: { type: 'string' },
      profile: { type: 'string' },
      'lens-profile': { type: 'string', multiple: true },
      'lane-profile': { type: 'string', multiple: true },
      'planner-profile': { type: 'string' },
      'preflight-profile': { type: 'string' },
      'topic-reducer-profile': { type: 'string' },
      'synthesis-profile': { type: 'string' },
      'global-synthesis-profile': { type: 'string' },
      'planner-task-id': { type: 'string' },
      'preflight-task-id': { type: 'string' },
      'topic-task-id': { type: 'string', multiple: true },
      'review-base-revision': { type: 'string' },
      'review-revision': { type: 'string' },
      'correlation-id': { type: 'string' },
      queue: { type: 'string' },
      'agent-dir': { type: 'string' },
      'poll-interval': { type: 'string' },
      concurrency: { type: 'string' },
      unattended: { type: 'boolean' },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) return { kind: 'help' };
  if (values.diff && values['diff-file']) {
    throw new Error('pass at most one of --diff or --diff-file');
  }
  const diff = values['diff-file']
    ? deps.readFile(values['diff-file'])
    : values.diff;
  if (diff === undefined) {
    throw new Error('--diff or --diff-file is required');
  }
  const githubFiles = parseMetadata(values['files-metadata'], deps);
  if (values.preflight) {
    return {
      kind: 'preflight',
      config: {
        diff,
        ...(githubFiles ? { githubFiles } : {}),
        ...(values['review-base-revision']
          ? {
              reviewBaseRevision: nonEmpty(
                values['review-base-revision'],
                '--review-base-revision',
              ),
            }
          : {}),
      },
    };
  }

  const databaseUrl = deps.env.MULTI_LENS_REVIEW_DATABASE_URL ?? '';
  if (!values.team) throw new Error('--team is required');
  if (!values.diary) throw new Error('--diary is required');
  if (!values.target) throw new Error('--target is required');
  if (!values['review-revision']) {
    throw new Error('--review-revision is required for a review run');
  }
  if (!values['review-base-revision']) {
    throw new Error('--review-base-revision is required for a review run');
  }
  if (!databaseUrl) {
    throw new Error(
      'MULTI_LENS_REVIEW_DATABASE_URL environment variable is required',
    );
  }
  const legacyLaneProfiles = parseProfiles(
    values['lens-profile'],
    '--lens-profile',
  );
  const laneProfiles = parseProfiles(values['lane-profile'], '--lane-profile');
  const duplicateLane = Object.keys(legacyLaneProfiles ?? {}).find((lane) =>
    Object.hasOwn(laneProfiles ?? {}, lane),
  );
  if (duplicateLane) {
    throw new Error(
      `profile override was repeated for lane "${duplicateLane}"`,
    );
  }
  if (values['synthesis-profile'] && values['global-synthesis-profile']) {
    throw new Error(
      'pass at most one of --synthesis-profile or --global-synthesis-profile',
    );
  }
  const hasOverrides =
    legacyLaneProfiles ||
    laneProfiles ||
    values['planner-profile'] ||
    values['preflight-profile'] ||
    values['topic-reducer-profile'] ||
    values['synthesis-profile'] ||
    values['global-synthesis-profile'];
  if (!values.profile && hasOverrides) {
    throw new Error(
      '--profile is required when profile routing overrides are supplied',
    );
  }
  const profileRoutingRefs = values.profile
    ? {
        defaultProfile: nonEmpty(values.profile, '--profile'),
        ...(values['planner-profile']
          ? {
              plannerProfile: nonEmpty(
                values['planner-profile'],
                '--planner-profile',
              ),
            }
          : {}),
        ...(values['preflight-profile']
          ? {
              preflightProfile: nonEmpty(
                values['preflight-profile'],
                '--preflight-profile',
              ),
            }
          : {}),
        ...(legacyLaneProfiles || laneProfiles
          ? {
              laneProfiles: {
                ...legacyLaneProfiles,
                ...laneProfiles,
              } as Partial<Record<ReviewLane, string>>,
            }
          : {}),
        ...(values['topic-reducer-profile']
          ? {
              topicReducerProfile: nonEmpty(
                values['topic-reducer-profile'],
                '--topic-reducer-profile',
              ),
            }
          : {}),
        ...(values['global-synthesis-profile'] || values['synthesis-profile']
          ? {
              globalSynthesisProfile: nonEmpty(
                values['global-synthesis-profile'] ??
                  (values['synthesis-profile'] as string),
                '--global-synthesis-profile',
              ),
            }
          : {}),
      }
    : undefined;
  return {
    kind: 'run',
    config: {
      databaseUrl,
      queueName: values.queue,
      agentDir: values['agent-dir'],
      diff,
      ...(githubFiles ? { githubFiles } : {}),
      profileRoutingRefs,
      input: {
        teamId: values.team,
        diaryId: values.diary,
        target: values.target,
        reviewBaseRevision: nonEmpty(
          values['review-base-revision'],
          '--review-base-revision',
        ),
        reviewRevision: nonEmpty(
          values['review-revision'],
          '--review-revision',
        ),
        plannerTaskId:
          values['planner-task-id'] === undefined
            ? undefined
            : nonEmpty(values['planner-task-id'], '--planner-task-id'),
        preflightTaskId:
          values['preflight-task-id'] === undefined
            ? undefined
            : nonEmpty(values['preflight-task-id'], '--preflight-task-id'),
        topicReviewTaskIds: values['topic-task-id']?.map((value) =>
          nonEmpty(value, '--topic-task-id'),
        ),
        lenses: values.lens,
        synthesisBrief: values.synthesis,
        correlationId: values['correlation-id'] ?? deps.randomUUID(),
        pollIntervalSec:
          values['poll-interval'] === undefined
            ? undefined
            : positiveInt(values['poll-interval'], '--poll-interval'),
        concurrency:
          values.concurrency === undefined
            ? undefined
            : positiveInt(values.concurrency, '--concurrency'),
        unattended: values.unattended,
      },
    },
  };
}
